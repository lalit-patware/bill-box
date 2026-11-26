"""Bill endpoints used by the PWA. Pages are uploaded by the client to Supabase Storage first."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import Cron, UserId
from app.bill_service import extract_bill, poll_bill_batches, submit_bills_batch
from app.routers.extraction import ClientDep
from app.supa import Repo, get_repo

router = APIRouter(prefix="/bills", tags=["bills"])

RepoDep = Annotated[Repo, Depends(get_repo)]


class BatchIn(BaseModel):
    bill_ids: list[str] = Field(min_length=1, max_length=200)


@router.post("/{bill_id}/extract")
def extract(bill_id: str, user_id: UserId, repo: RepoDep, client: ClientDep) -> dict[str, Any]:
    return extract_bill(repo, client, bill_id, user_id)


@router.post("/batch")
def batch(body: BatchIn, user_id: UserId, repo: RepoDep, client: ClientDep) -> dict[str, Any]:
    if len(set(body.bill_ids)) != len(body.bill_ids):
        raise HTTPException(400, "Duplicate bill ids")
    batch_id = submit_bills_batch(repo, client, body.bill_ids, user_id)
    return {"batch_id": batch_id, "status": "processing", "count": len(body.bill_ids)}


@router.post("/jobs/poll-batches", include_in_schema=False)
def jobs_poll(_: Cron, repo: RepoDep, client: ClientDep) -> dict[str, Any]:
    return poll_bill_batches(repo, client)
