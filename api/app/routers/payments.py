"""Plans, Razorpay orders, payment verification and webhook."""

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import UserId
from app.config import get_settings
from app.payments import (
    Gateway,
    captured_payment,
    checkout_signature_ok,
    gateway_dep,
    payments_enabled,
    webhook_signature_ok,
)
from app.plans import FREE_SCANS_PER_MONTH, PLANS
from app.supa import Repo, get_repo

log = logging.getLogger("billvault.payments")
router = APIRouter(prefix="/payments", tags=["payments"])

RepoDep = Annotated[Repo, Depends(get_repo)]
GatewayDep = Annotated[Gateway | None, Depends(gateway_dep)]


class OrderIn(BaseModel):
    plan: str
    household_id: str


class VerifyIn(BaseModel):
    razorpay_order_id: str = Field(min_length=1)
    razorpay_payment_id: str = Field(min_length=1)
    razorpay_signature: str = Field(min_length=1)


@router.get("/plans")
def plans() -> dict[str, Any]:
    return {
        "enabled": payments_enabled(),
        "free_per_month": FREE_SCANS_PER_MONTH,
        "plans": [p.model_dump() for p in PLANS.values()],
    }


@router.post("/order")
def create_order(
    body: OrderIn, user_id: UserId, repo: RepoDep, gateway: GatewayDep
) -> dict[str, Any]:
    if gateway is None:
        raise HTTPException(503, "Payments are not set up yet")
    plan = PLANS.get(body.plan)
    if plan is None:
        raise HTTPException(400, "Unknown plan")
    if not repo.is_member(body.household_id, user_id):
        raise HTTPException(404, "Household not found")
    order_id = gateway.create_order(
        plan.amount_paise,
        receipt=f"{plan.id}-{body.household_id[:8]}",
        notes={"household_id": body.household_id, "plan": plan.id},
    )
    repo.create_payment(
        {
            "household_id": body.household_id,
            "user_id": user_id,
            "plan": plan.id,
            "amount_paise": plan.amount_paise,
            "credits": plan.credits,
            "razorpay_order_id": order_id,
        }
    )
    return {
        "order_id": order_id,
        "key_id": gateway.key_id,
        "amount_paise": plan.amount_paise,
        "name": plan.name,
    }


@router.post("/verify")
def verify(body: VerifyIn, user_id: UserId, repo: RepoDep) -> dict[str, Any]:
    payment = repo.get_payment(body.razorpay_order_id)
    if payment is None or not repo.is_member(payment["household_id"], user_id):
        raise HTTPException(404, "Order not found")
    secret = get_settings().razorpay_key_secret
    if not checkout_signature_ok(
        body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature, secret
    ):
        raise HTTPException(400, "Payment could not be verified")
    credited = repo.apply_payment(body.razorpay_order_id, body.razorpay_payment_id)
    return {"ok": True, "credited": credited, "credits": payment["credits"]}


@router.post("/webhook", include_in_schema=False)
async def webhook(
    request: Request,
    repo: RepoDep,
    x_razorpay_signature: Annotated[str, Header()] = "",
) -> dict[str, Any]:
    body = await request.body()
    if not webhook_signature_ok(body, x_razorpay_signature, get_settings().razorpay_webhook_secret):
        raise HTTPException(401, "Bad signature")
    try:
        event = json.loads(body)
    except ValueError as exc:
        raise HTTPException(400, "Bad JSON") from exc
    ids = captured_payment(event)
    if ids is None:
        return {"ok": True, "ignored": event.get("event")}
    credited = repo.apply_payment(*ids)
    log.info("webhook %s credited=%s", event.get("event"), credited)
    return {"ok": True, "credited": credited}
