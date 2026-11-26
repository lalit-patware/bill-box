"""Load a bill's pages from storage, extract, and save results back to Supabase."""

import mimetypes
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException

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


def save_result(repo: Repo, bill_id: str, result: ExtractResult) -> dict[str, Any]:
    fields, items, products = result_to_rows(result, bill_id)
    repo.replace_children(bill_id, items, products)
    repo.update_bill(bill_id, fields)
    return fields


def extract_bill(repo: Repo, client: MessagesClient, bill_id: str, user_id: str) -> dict[str, Any]:
    bill = load_bill_for_user(repo, bill_id, user_id)
    files = bill_files(repo, bill)
    try:
        result = extract_live(files, bill.get("hints"), client)
    except ExtractionError as exc:
        repo.update_bill(bill_id, {"status": "failed", "error": str(exc)[:500]})
        raise HTTPException(502, "Could not read this bill") from exc
    return save_result(repo, bill_id, result)


def submit_bills_batch(
    repo: Repo, client: MessagesClient, bill_ids: list[str], user_id: str
) -> str:
    jobs = []
    for bid in bill_ids:
        bill = load_bill_for_user(repo, bid, user_id)
        jobs.append((bid, bill_files(repo, bill), bill.get("hints")))
    batch_id = submit_batch(jobs, client)
    for bid in bill_ids:
        repo.update_bill(bid, {"status": "processing", "batch_id": batch_id})
    return batch_id


def poll_bill_batches(repo: Repo, client: MessagesClient) -> dict[str, Any]:
    summary: dict[str, Any] = {"checked": 0, "completed": [], "bills_done": 0, "bills_failed": 0}
    for batch_id in repo.processing_batches():
        summary["checked"] += 1
        if batch_status(batch_id, client) != "ended":
            continue
        for bill_id, r in collect_batch(batch_id, client).items():
            if isinstance(r, ExtractResult):
                save_result(repo, bill_id, r)
                summary["bills_done"] += 1
            else:
                repo.update_bill(bill_id, {"status": "failed", "error": r[:500]})
                summary["bills_failed"] += 1
        summary["completed"].append(batch_id)
        # Phase 4: Web Push "N bills are ready".
    return summary
