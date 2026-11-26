"""Live and batch extraction with Claude Haiku 5.5."""

import time
from typing import Any, Protocol

from app.config import get_settings
from app.llm.request_builder import PROMPT_VERSION, TOOL_NAME, BillFile, extract_request
from app.llm.schemas import Extraction, ExtractResult, Usage
from app.llm.tracing import trace_extraction
from app.llm.validate import validate


class ExtractionError(RuntimeError):
    pass


class MessagesClient(Protocol):
    """The subset of anthropic.Anthropic we use; lets tests inject a fake."""

    @property
    def messages(self) -> Any: ...


def get_client() -> MessagesClient:
    import anthropic

    s = get_settings()
    if not s.anthropic_api_key:
        raise ExtractionError("ANTHROPIC_API_KEY is not set")
    return anthropic.Anthropic(api_key=s.anthropic_api_key)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def usage_from(raw_usage: Any, batch: bool = False) -> Usage:
    s = get_settings()
    u = Usage(
        input_tokens=_get(raw_usage, "input_tokens", 0) or 0,
        output_tokens=_get(raw_usage, "output_tokens", 0) or 0,
        cache_read_input_tokens=_get(raw_usage, "cache_read_input_tokens", 0) or 0,
        cache_creation_input_tokens=_get(raw_usage, "cache_creation_input_tokens", 0) or 0,
    )
    # Cache reads bill at 0.1x input, cache writes at 1.25x input.
    input_equiv = (
        u.input_tokens + 0.1 * u.cache_read_input_tokens + 1.25 * u.cache_creation_input_tokens
    )
    usd = (
        input_equiv * s.price_input_per_mtok + u.output_tokens * s.price_output_per_mtok
    ) / 1_000_000
    if batch:
        usd *= s.batch_discount
    u.cost_inr = round(usd * s.usd_to_inr, 4)
    return u


def parse_message(message: Any, batch: bool = False) -> ExtractResult:
    """Turn a Messages API response (object or dict) into a validated ExtractResult."""
    blocks = _get(message, "content", []) or []
    tool_input = next(
        (
            _get(b, "input")
            for b in blocks
            if _get(b, "type") == "tool_use" and _get(b, "name") == TOOL_NAME
        ),
        None,
    )
    if tool_input is None:
        raise ExtractionError("Model did not call record_bill")

    extraction = Extraction.model_validate(tool_input)
    return ExtractResult(
        extraction=extraction,
        validation=validate(extraction),
        usage=usage_from(_get(message, "usage", {}), batch=batch),
        prompt_version=PROMPT_VERSION,
        model=_get(message, "model", get_settings().anthropic_model),
        raw={"tool_input": tool_input},
    )


def extract_live(
    files: list[BillFile],
    hints: dict[str, Any] | None = None,
    client: MessagesClient | None = None,
) -> ExtractResult:
    client = client or get_client()
    params = extract_request(files, hints)
    started = time.perf_counter()
    message = client.messages.create(**params)
    result = parse_message(message)
    trace_extraction(
        {
            "path": "live",
            "prompt_version": result.prompt_version,
            "model": result.model,
            "pages": len(files),
            "bill_kind": result.extraction.bill_kind.value.value,
            "input_tokens": result.usage.input_tokens,
            "output_tokens": result.usage.output_tokens,
            "cache_read": result.usage.cache_read_input_tokens,
            "cost_inr": result.usage.cost_inr,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "low_confidence": len(result.validation.low_confidence_fields),
            "total_mismatch": result.validation.total_mismatch,
        }
    )
    return result


def submit_batch(
    jobs: list[tuple[str, list[BillFile], dict[str, Any] | None]],
    client: MessagesClient | None = None,
) -> str:
    """Submit (custom_id, files, hints) jobs. Returns the Anthropic batch id."""
    if not jobs:
        raise ValueError("No jobs to submit")
    client = client or get_client()
    requests = [
        {"custom_id": cid, "params": extract_request(files, hints)} for cid, files, hints in jobs
    ]
    batch = client.messages.batches.create(requests=requests)
    return str(_get(batch, "id"))


def batch_status(batch_id: str, client: MessagesClient | None = None) -> str:
    client = client or get_client()
    batch = client.messages.batches.retrieve(batch_id)
    return str(_get(batch, "processing_status"))


def collect_batch(
    batch_id: str, client: MessagesClient | None = None
) -> dict[str, ExtractResult | str]:
    """Return {custom_id: ExtractResult | error string} for an ended batch."""
    client = client or get_client()
    out: dict[str, ExtractResult | str] = {}
    for entry in client.messages.batches.results(batch_id):
        cid = str(_get(entry, "custom_id"))
        result = _get(entry, "result")
        rtype = _get(result, "type")
        if rtype == "succeeded":
            try:
                out[cid] = parse_message(_get(result, "message"), batch=True)
            except Exception as exc:  # noqa: BLE001
                out[cid] = f"parse_error: {exc}"
        else:
            out[cid] = f"{rtype}"
    return out
