import hashlib
import hmac
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import current_user_id
from app.config import get_settings
from app.main import app
from app.payments import captured_payment, checkout_signature_ok, gateway_dep, webhook_signature_ok
from app.supa import get_repo

HH = "11111111-1111-1111-1111-111111111111"
KEY_SECRET = "test_key_secret"
HOOK_SECRET = "test_webhook_secret"


class Repo:
    def __init__(self) -> None:
        self.members = {(HH, "user-a")}
        self.payments: dict[str, dict[str, Any]] = {}
        self.credits = 0

    def is_member(self, household_id: str, user_id: str) -> bool:
        return (household_id, user_id) in self.members

    def create_payment(self, row: dict[str, Any]) -> None:
        self.payments[row["razorpay_order_id"]] = {**row, "status": "created"}

    def get_payment(self, order_id: str) -> dict[str, Any] | None:
        return self.payments.get(order_id)

    def apply_payment(self, order_id: str, payment_id: str) -> bool:
        p = self.payments.get(order_id)
        if p is None or p["status"] == "paid":
            return False
        p.update(status="paid", razorpay_payment_id=payment_id)
        self.credits += p["credits"]
        return True


class Gateway:
    key_id = "rzp_test_abc"

    def __init__(self) -> None:
        self.orders: list[tuple[int, dict[str, str]]] = []

    def create_order(self, amount_paise: int, receipt: str, notes: dict[str, str]) -> str:
        self.orders.append((amount_paise, notes))
        return f"order_{len(self.orders)}"


def sign(msg: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch):
    s = get_settings()
    monkeypatch.setattr(s, "razorpay_key_id", "rzp_test_abc")
    monkeypatch.setattr(s, "razorpay_key_secret", KEY_SECRET)
    monkeypatch.setattr(s, "razorpay_webhook_secret", HOOK_SECRET)
    repo, gw = Repo(), Gateway()
    app.dependency_overrides[get_repo] = lambda: repo
    app.dependency_overrides[gateway_dep] = lambda: gw
    app.dependency_overrides[current_user_id] = lambda: "user-a"
    yield TestClient(app), repo, gw
    app.dependency_overrides.clear()


def test_plans_public() -> None:
    r = TestClient(app).get("/payments/plans")
    body = r.json()
    assert r.status_code == 200 and body["free_per_month"] == 5
    assert {p["id"]: p["amount_paise"] for p in body["plans"]} == {"pack25": 1000, "family": 9900}


def test_order_amount_comes_from_server(env) -> None:
    c, repo, gw = env
    r = c.post("/payments/order", json={"plan": "pack25", "household_id": HH})
    assert r.status_code == 200
    assert r.json() == {
        "order_id": "order_1",
        "key_id": "rzp_test_abc",
        "amount_paise": 1000,
        "name": "25 scans",
    }
    assert gw.orders[0] == (1000, {"household_id": HH, "plan": "pack25"})
    assert repo.payments["order_1"]["credits"] == 25


def test_order_rejects_unknown_plan_and_other_household(env) -> None:
    c, _, _ = env
    assert (
        c.post("/payments/order", json={"plan": "free1000", "household_id": HH}).status_code == 400
    )
    other = "22222222-2222-2222-2222-222222222222"
    assert (
        c.post("/payments/order", json={"plan": "pack25", "household_id": other}).status_code == 404
    )


def test_verify_credits_once(env) -> None:
    c, repo, _ = env
    c.post("/payments/order", json={"plan": "family", "household_id": HH})
    good = {
        "razorpay_order_id": "order_1",
        "razorpay_payment_id": "pay_9",
        "razorpay_signature": sign(b"order_1|pay_9", KEY_SECRET),
    }
    bad = {**good, "razorpay_signature": "0" * 64}
    assert c.post("/payments/verify", json=bad).status_code == 400
    assert repo.credits == 0
    r = c.post("/payments/verify", json=good)
    assert r.json() == {"ok": True, "credited": True, "credits": 300}
    assert c.post("/payments/verify", json=good).json()["credited"] is False
    assert repo.credits == 300


def test_webhook_signature_and_idempotency(env) -> None:
    c, repo, _ = env
    c.post("/payments/order", json={"plan": "pack25", "household_id": HH})
    event = {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_1", "order_id": "order_1"}}},
    }
    raw = json.dumps(event).encode()
    assert (
        c.post(
            "/payments/webhook", content=raw, headers={"X-Razorpay-Signature": "nope"}
        ).status_code
        == 401
    )
    h = {"X-Razorpay-Signature": sign(raw, HOOK_SECRET), "Content-Type": "application/json"}
    assert c.post("/payments/webhook", content=raw, headers=h).json()["credited"] is True
    assert c.post("/payments/webhook", content=raw, headers=h).json()["credited"] is False
    assert repo.credits == 25


def test_payments_off_without_keys() -> None:
    app.dependency_overrides[gateway_dep] = lambda: None
    app.dependency_overrides[current_user_id] = lambda: "user-a"
    app.dependency_overrides[get_repo] = lambda: Repo()
    try:
        r = TestClient(app).post("/payments/order", json={"plan": "pack25", "household_id": HH})
        assert r.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_helpers() -> None:
    assert checkout_signature_ok("o", "p", sign(b"o|p", "s"), "s")
    assert not checkout_signature_ok("o", "p", sign(b"o|p", "s"), "")
    assert webhook_signature_ok(b"{}", sign(b"{}", "w"), "w")
    assert captured_payment({"event": "payment.failed"}) is None
    assert captured_payment(
        {"event": "order.paid", "payload": {"payment": {"entity": {"id": "p", "order_id": "o"}}}}
    ) == ("o", "p")
