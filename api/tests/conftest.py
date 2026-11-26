from types import SimpleNamespace
from typing import Any

import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("BATCH_STORE_PATH", str(tmp_path / "batches.json"))
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "")
    get_settings.cache_clear()


def tool_message(tool_input: dict[str, Any], **usage: int) -> SimpleNamespace:
    return SimpleNamespace(
        model="claude-haiku-5-5",
        content=[SimpleNamespace(type="tool_use", name="record_bill", input=tool_input)],
        usage=SimpleNamespace(
            input_tokens=usage.get("input_tokens", 2000),
            output_tokens=usage.get("output_tokens", 500),
            cache_read_input_tokens=usage.get("cache_read_input_tokens", 1500),
            cache_creation_input_tokens=usage.get("cache_creation_input_tokens", 0),
        ),
    )


LAUNDRY = {
    "bill_kind": {"value": "laundry", "confidence": 0.95},
    "vendor_name": {"value": "Shree Dhobi Ghat", "confidence": 0.9},
    "bill_no": {"value": "4417", "confidence": 0.85},
    "bill_date": {"value": "2026-11-03", "confidence": 0.9},
    "piece_count": {"value": 12, "confidence": 0.9},
    "items": [
        {"name": "shirt", "qty": 8, "rate": 20, "amount": 160, "confidence": 0.9},
        {"name": "trouser", "qty": 4, "rate": 20, "amount": 80, "confidence": 0.9},
    ],
    "total": {"value": 240, "confidence": 0.95},
    "is_handwritten": {"value": True, "confidence": 0.95},
}


class FakeBatches:
    def __init__(self, results: list[Any]) -> None:
        self.created: list[dict[str, Any]] = []
        self._results = results
        self.status = "in_progress"

    def create(self, requests: list[dict[str, Any]]) -> SimpleNamespace:
        self.created = requests
        return SimpleNamespace(id="msgbatch_test")

    def retrieve(self, batch_id: str) -> SimpleNamespace:
        return SimpleNamespace(id=batch_id, processing_status=self.status)

    def results(self, batch_id: str) -> list[Any]:
        return self._results


class FakeMessages:
    def __init__(self, response: Any = None, batch_results: list[Any] | None = None) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []
        self.batches = FakeBatches(batch_results or [])

    def create(self, **params: Any) -> Any:
        self.calls.append(params)
        return self.response


class FakeClient:
    def __init__(self, response: Any = None, batch_results: list[Any] | None = None) -> None:
        self.messages = FakeMessages(response, batch_results)
