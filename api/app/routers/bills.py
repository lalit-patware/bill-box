"""Bill endpoints used by the PWA. Pages are uploaded by the client to Supabase Storage first."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import Cron, UserId
from app.bill_service import (
    extract_bill,
    poll_bill_batches,
    submit_bills_batch,
)
from app.config import get_settings
from app.jobs.reminders import default_mailer, default_pusher, send_due_reminders
from app.routers.extraction import OptionalClientDep
from app.supa import Repo, get_repo

router = APIRouter(prefix="/bills", tags=["bills"])

RepoDep = Annotated[Repo, Depends(get_repo)]


class BatchIn(BaseModel):
    bill_ids: list[str] = Field(min_length=1, max_length=200)


class ExchangeDaysIn(BaseModel):
    days: int = Field(ge=0, le=365)


@router.post("/{bill_id}/extract")
def extract(
    bill_id: str, user_id: UserId, repo: RepoDep, client: OptionalClientDep
) -> dict[str, Any]:
    return extract_bill(repo, client, bill_id, user_id)


@router.post("/batch")
def batch(
    body: BatchIn, user_id: UserId, repo: RepoDep, client: OptionalClientDep
) -> dict[str, Any]:
    if len(set(body.bill_ids)) != len(body.bill_ids):
        raise HTTPException(400, "Duplicate bill ids")
    batch_id = submit_bills_batch(repo, client, body.bill_ids, user_id)
    status = "processing" if batch_id else "saved_without_ai"
    return {"batch_id": batch_id, "status": status, "count": len(body.bill_ids)}


@router.post("/jobs/poll-batches", include_in_schema=False)
def jobs_poll(_: Cron, repo: RepoDep, client: OptionalClientDep) -> dict[str, Any]:
    return poll_bill_batches(repo, client)


@router.post("/{bill_id}/exchange-days")
def exchange_days(
    bill_id: str, body: ExchangeDaysIn, user_id: UserId, repo: RepoDep
) -> dict[str, Any]:
    """User sets the shop's exchange window; remembered for that shop's future bills."""
    bill = repo.get_bill(bill_id)
    if bill is None or not repo.is_member(bill["household_id"], user_id):
        raise HTTPException(404, "Bill not found")
    repo.set_exchange_days(bill_id, body.days)
    return {"ok": True, "days": body.days}


@router.post("/jobs/send-reminders", include_in_schema=False)
def jobs_send_reminders(_: Cron, repo: RepoDep) -> dict[str, Any]:
    s = get_settings()
    return send_due_reminders(repo, default_pusher(s), default_mailer(s), s.app_url)


@router.post("/{bill_id}/refresh")
def refresh(bill_id: str, user_id: UserId, repo: RepoDep) -> dict[str, Any]:
    """After the user fixes a field: re-link vendor, ledger and reminders."""
    bill = repo.get_bill(bill_id)
    if bill is None or not repo.is_member(bill["household_id"], user_id):
        raise HTTPException(404, "Bill not found")
    repo.after_saved(bill_id)
    return {"ok": True}
