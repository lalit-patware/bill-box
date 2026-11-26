"""Razorpay one-time payments: create order → Checkout → verify signature → credit scans.

The webhook is a safety net (app closed mid-payment); crediting is idempotent in SQL.
"""

import hashlib
import hmac
from typing import Any, Protocol

import httpx

from app.config import Settings, get_settings


class Gateway(Protocol):
    key_id: str

    def create_order(self, amount_paise: int, receipt: str, notes: dict[str, str]) -> str: ...


class Razorpay:
    def __init__(self, settings: Settings) -> None:
        self.key_id = settings.razorpay_key_id
        self.secret = settings.razorpay_key_secret

    def create_order(self, amount_paise: int, receipt: str, notes: dict[str, str]) -> str:
        r = httpx.post(
            "https://api.razorpay.com/v1/orders",
            auth=(self.key_id, self.secret),
            json={
                "amount": amount_paise,
                "currency": "INR",
                "receipt": receipt[:40],
                "notes": notes,
            },
            timeout=15,
        )
        r.raise_for_status()
        return str(r.json()["id"])


def payments_enabled(settings: Settings | None = None) -> bool:
    s = settings or get_settings()
    return bool(s.razorpay_key_id and s.razorpay_key_secret)


def gateway_dep() -> Gateway | None:
    s = get_settings()
    return Razorpay(s) if payments_enabled(s) else None


def _hmac(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def checkout_signature_ok(order_id: str, payment_id: str, signature: str, secret: str) -> bool:
    """Razorpay Checkout: HMAC_SHA256(order_id|payment_id, key_secret)."""
    if not (secret and signature):
        return False
    return hmac.compare_digest(_hmac(secret, f"{order_id}|{payment_id}".encode()), signature)


def webhook_signature_ok(body: bytes, signature: str, secret: str) -> bool:
    """Webhook: HMAC_SHA256(raw body, webhook secret) in X-Razorpay-Signature."""
    if not (secret and signature):
        return False
    return hmac.compare_digest(_hmac(secret, body), signature)


def captured_payment(event: dict[str, Any]) -> tuple[str, str] | None:
    """(order_id, payment_id) for payment.captured / order.paid events, else None."""
    if event.get("event") not in ("payment.captured", "order.paid"):
        return None
    payment = (event.get("payload") or {}).get("payment", {}).get("entity") or {}
    order_id, payment_id = payment.get("order_id"), payment.get("id")
    if not (order_id and payment_id):
        return None
    return str(order_id), str(payment_id)
