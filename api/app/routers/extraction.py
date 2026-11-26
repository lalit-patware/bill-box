"""Direct-upload extraction endpoints (dev/testing). The PWA uses /bills/* instead.

Both require a signed-in user; quotas and rate limits arrive in Phases 5–6.
"""

import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.auth import Cron, UserId
from app.config import Settings, get_settings
from app.jobs.poll_batches import poll_batches
from app.llm.extractor import (
    ExtractionError,
    MessagesClient,
    extract_live,
    get_client,
    submit_batch,
)
from app.llm.request_builder import PDF_TYPE, SUPPORTED_IMAGE_TYPES, BillFile
from app.llm.schemas import ExtractResult
from app.store import BatchStore

router = APIRouter()


def client_dep() -> MessagesClient:
    try:
        return get_client()
    except ExtractionError as exc:
        raise HTTPException(503, str(exc)) from exc


def store_dep() -> BatchStore:
    return BatchStore()


ClientDep = Annotated[MessagesClient, Depends(client_dep)]
StoreDep = Annotated[BatchStore, Depends(store_dep)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def _read_files(files: list[UploadFile], settings: Settings) -> list[BillFile]:
    out: list[BillFile] = []
    limit = settings.max_upload_mb * 1024 * 1024
    for f in files:
        media_type = (f.content_type or "").lower()
        if media_type == "image/jpg":
            media_type = "image/jpeg"
        if media_type not in SUPPORTED_IMAGE_TYPES | {PDF_TYPE}:
            raise HTTPException(415, f"Unsupported file type: {media_type or 'unknown'}")
        data = await f.read()
        if len(data) > limit:
            raise HTTPException(413, f"{f.filename} is larger than {settings.max_upload_mb} MB")
        if not data:
            raise HTTPException(400, f"{f.filename} is empty")
        out.append(BillFile(data=data, media_type=media_type))
    return out


def _parse_hints(hints: str | None) -> dict[str, Any] | None:
    if not hints:
        return None
    try:
        parsed = json.loads(hints)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "hints must be JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(400, "hints must be a JSON object")
    return parsed


@router.post("/extract", response_model=ExtractResult)
async def extract(
    _user: UserId,
    client: ClientDep,
    settings: SettingsDep,
    files: Annotated[list[UploadFile], File(description="Pages of ONE bill")],
    hints: Annotated[str | None, Form(description="JSON from on-device QR/barcode")] = None,
) -> ExtractResult:
    if len(files) > settings.max_files_live:
        raise HTTPException(
            400, f"Max {settings.max_files_live} pages for live extraction; use /batch"
        )
    bill_files = await _read_files(files, settings)
    try:
        return extract_live(bill_files, _parse_hints(hints), client)
    except ExtractionError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/batch")
async def batch(
    _user: UserId,
    client: ClientDep,
    store: StoreDep,
    settings: SettingsDep,
    files: Annotated[list[UploadFile], File(description="One file per bill")],
) -> dict[str, Any]:
    """Bulk import: each uploaded file is treated as a separate single-page bill."""
    bill_files = await _read_files(files, settings)
    jobs = [(f"bill-{uuid.uuid4().hex[:24]}", [bf], None) for bf in bill_files]
    batch_id = submit_batch(jobs, client)
    store.create(batch_id, [cid for cid, _, _ in jobs])
    return {"batch_id": batch_id, "custom_ids": [cid for cid, _, _ in jobs], "status": "processing"}


@router.get("/batch/{batch_id}")
def batch_get(batch_id: str, _user: UserId, store: StoreDep) -> dict[str, Any]:
    entry = store.get(batch_id)
    if entry is None:
        raise HTTPException(404, "Unknown batch")
    return entry


@router.post("/jobs/poll-batches")
def jobs_poll_batches(_: Cron, client: ClientDep, store: StoreDep) -> dict[str, Any]:
    return poll_batches(store, client)
