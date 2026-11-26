"""Load a bill's pages from storage, extract, and save results back to Supabase."""

import logging
import mimetypes
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException

from app.config import get_settings
from app.llm.extractor import (
    ExtractionError,
    MessagesClient,
    batch_status,
    collect_batch,
    extract_live,
    submit_batch,
)
from app.llm.request_builder import PDF_TYPE, SUPPORTED_IMAGE_TYPES, BillFile
from app.llm.schemas import BillKind, ExtractResult
from app.supa import Repo

log = logging.getLogger("billvault.bills")

NO_AI_VERSION = "no-ai"


def _iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    raise ValueError("unreachable")


def load_bill_for_user(repo: Repo, bill_id: str, user_id: str) -> dict[str, Any]:
    bill = repo.get_bill(bill_id)
    # Same 404 for "missing" and "not yours" so ids can't be probed.
    if bill is None or not repo.is_member(bill["household_id"], user_id):
        raise HTTPException(404, "Bill not found")
    if not bill.get("page_paths"):
        raise HTTPException(400, "Bill has no uploaded pages")
    return bill


def bill_files(repo: Repo, bill: dict[str, Any]) -> list[BillFile]:
    files: list[BillFile] = []
    for path in bill["page_paths"]:
        if not str(path).startswith(f"{bill['household_id']}/"):
            raise HTTPException(400, "Page path outside household folder")
        media_type = mimetypes.guess_type(path)[0] or ""
        if media_type not in SUPPORTED_IMAGE_TYPES | {PDF_TYPE}:
            raise HTTPException(415, f"Unsupported page type: {path}")
        files.append(BillFile(repo.download(path), media_type))
    return files


def result_to_rows(
    result: ExtractResult, bill_id: str
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    ex, v = result.extraction, result.validation
    bill_date = _iso_date(ex.bill_date.value)
    kind = ex.bill_kind.value

    fields: dict[str, Any] = {
        "status": "done",
        "error": None,
        "bill_kind": kind.value,
        "vendor_name": ex.vendor_name.value,
        "bill_date": bill_date.isoformat() if bill_date else None,
        "bill_no": ex.bill_no.value,
        "total": ex.total.value,
        "tax": ex.tax.value,
        "is_handwritten": ex.is_handwritten.value,
        "total_mismatch": v.total_mismatch,
        "needs_fix": bool(v.low_confidence_fields) or v.total_mismatch,
        "raw_extraction": ex.model_dump(mode="json"),
        "validation": v.model_dump(mode="json"),
        "prompt_version": result.prompt_version,
        "cost_inr": result.usage.cost_inr,
        "ai_pending": False,
    }

    items = [
        {
            "bill_id": bill_id,
            "position": i,
            "name": it.name,
            "qty": it.qty,
            "unit": it.unit,
            "rate": it.rate,
            "amount": it.amount,
        }
        for i, it in enumerate(ex.items)
    ]

    products: list[dict[str, Any]] = []
    warranty = ex.warranty_months.value
    exchange = ex.exchange_days.value
    if kind in (BillKind.electronics, BillKind.retail_fashion) and (
        ex.serial_no.value or warranty or exchange
    ):
        products.append(
            {
                "bill_id": bill_id,
                "name": ex.items[0].name if ex.items else None,
                "serial_no": ex.serial_no.value,
                "warranty_until": (
                    _add_months(bill_date, warranty).isoformat() if bill_date and warranty else None
                ),
                "exchange_until": (
                    (bill_date + timedelta(days=exchange)).isoformat()
                    if bill_date and exchange
                    else None
                ),
            }
        )
    return fields, items, products


def _gst_date(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def fallback_fields(bill: dict[str, Any], reason: str) -> dict[str, Any]:
    """Non-AI mode: keep the bill, fill what on-device QR/barcode reading gave us,
    and mark it for an automatic AI re-read later."""
    hints = bill.get("hints") or {}
    gst = hints.get("gst") or {}
    upi = hints.get("upi") or {}

    vendor = upi.get("pn") or (f"GSTIN {gst['sellerGstin']}" if gst.get("sellerGstin") else None)
    total = gst.get("totalValue")
    return {
        "status": "done",
        "ai_pending": True,
        "error": reason[:500],
        "bill_kind": "general" if (gst or upi) else None,
        "vendor_name": vendor,
        "bill_no": gst.get("docNo"),
        "bill_date": _gst_date(gst.get("docDate")),
        "total": float(total) if isinstance(total, int | float) else None,
        "needs_fix": False,
        "prompt_version": NO_AI_VERSION,
        "cost_inr": 0,
    }


def save_fallback(repo: Repo, bill: dict[str, Any], reason: str) -> dict[str, Any]:
    fields = fallback_fields(bill, reason)
    repo.update_bill(bill["id"], fields)
    return fields


def save_result(repo: Repo, bill_id: str, result: ExtractResult) -> dict[str, Any]:
    fields, items, products = result_to_rows(result, bill_id)
    repo.replace_children(bill_id, items, products)
    repo.update_bill(bill_id, fields)
    return fields


def _try_ai(repo: Repo, client: MessagesClient, bill: dict[str, Any]) -> ExtractResult | str:
    """Run the model; on ANY failure return a short reason instead of raising."""
    try:
        return extract_live(bill_files(repo, bill), bill.get("hints"), client)
    except HTTPException:
        raise  # bad input (path/type) — not an AI problem
    except ExtractionError as exc:
        return f"ai_unreadable: {exc}"
    except Exception as exc:  # noqa: BLE001 — network, rate limit, Anthropic outage
        log.warning("AI call failed for bill %s: %s", bill.get("id"), type(exc).__name__)
        return f"ai_unavailable: {type(exc).__name__}"


def extract_bill(
    repo: Repo, client: MessagesClient | None, bill_id: str, user_id: str
) -> dict[str, Any]:
    """Never fails the user: with AI → full read; without/failing AI → saved with QR data."""
    bill = load_bill_for_user(repo, bill_id, user_id)
    if client is None:
        bill_files(repo, bill)  # still validate the pages exist and are ours
        return save_fallback(repo, bill, "ai_disabled")
    result = _try_ai(repo, client, bill)
    if isinstance(result, str):
        return save_fallback(repo, bill, result)
    return save_result(repo, bill_id, result)


def submit_bills_batch(
    repo: Repo, client: MessagesClient | None, bill_ids: list[str], user_id: str
) -> str | None:
    bills = [load_bill_for_user(repo, bid, user_id) for bid in bill_ids]
    if client is None:
        for b in bills:
            save_fallback(repo, b, "ai_disabled")
        return None
    jobs = [(b["id"], bill_files(repo, b), b.get("hints")) for b in bills]
    try:
        batch_id = submit_batch(jobs, client)
    except Exception as exc:  # noqa: BLE001
        log.warning("Batch submit failed: %s", type(exc).__name__)
        for b in bills:
            save_fallback(repo, b, f"ai_unavailable: {type(exc).__name__}")
        return None
    for bid in bill_ids:
        repo.update_bill(bid, {"status": "processing", "batch_id": batch_id})
    return batch_id


def poll_bill_batches(repo: Repo, client: MessagesClient | None) -> dict[str, Any]:
    """Cron (every 5 min): collect finished batches, then re-read "details pending" bills."""
    summary: dict[str, Any] = {
        "checked": 0,
        "completed": [],
        "bills_done": 0,
        "bills_failed": 0,
        "reprocessed": 0,
        "ai": client is not None,
    }
    if client is None:
        return summary

    for batch_id, bill_ids in repo.processing_batches().items():
        summary["checked"] += 1
        try:
            if batch_status(batch_id, client) != "ended":
                continue
            results = collect_batch(batch_id, client)
        except Exception as exc:  # noqa: BLE001 — try again next run
            log.warning("Batch %s poll failed: %s", batch_id, type(exc).__name__)
            continue
        for bill_id in bill_ids:
            r = results.get(bill_id, "missing_result")
            if isinstance(r, ExtractResult):
                save_result(repo, bill_id, r)
                summary["bills_done"] += 1
            else:
                repo.update_bill(bill_id, fallback_fields(repo.get_bill(bill_id) or {}, r))
                summary["bills_failed"] += 1
        summary["completed"].append(batch_id)
        # Phase 4: Web Push "N bills are ready".

    for bill in repo.ai_pending_bills(get_settings().reprocess_limit):
        try:
            result = _try_ai(repo, client, bill)
        except HTTPException as exc:  # broken pages: stop retrying this bill
            repo.update_bill(bill["id"], {"ai_pending": False, "error": str(exc.detail)[:500]})
            continue
        if isinstance(result, ExtractResult):
            save_result(repo, bill["id"], result)
            summary["reprocessed"] += 1
        else:
            break  # AI still unhealthy; stop for this run
    return summary
