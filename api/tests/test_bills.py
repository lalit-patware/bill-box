from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import current_user_id
from app.bill_service import _add_months, result_to_rows
from app.llm.extractor import parse_message
from app.main import app
from app.routers.extraction import client_dep
from app.supa import get_repo
from tests.conftest import LAUNDRY, FakeClient, tool_message

HH = "11111111-1111-1111-1111-111111111111"
OTHER_HH = "22222222-2222-2222-2222-222222222222"


class FakeRepo:
    def __init__(self) -> None:
        self.bills: dict[str, dict[str, Any]] = {
            "b1": {"id": "b1", "household_id": HH, "page_paths": [f"{HH}/b1/1.jpg"], "hints": None},
            "b2": {"id": "b2", "household_id": OTHER_HH, "page_paths": [f"{OTHER_HH}/b2/1.jpg"]},
            "b3": {"id": "b3", "household_id": HH, "page_paths": [f"{OTHER_HH}/b2/1.jpg"]},
        }
        self.members = {(HH, "user-a")}
        self.items: dict[str, list] = {}
        self.products: dict[str, list] = {}

    def get_bill(self, bill_id: str) -> dict[str, Any] | None:
        return self.bills.get(bill_id)

    def is_member(self, household_id: str, user_id: str) -> bool:
        return (household_id, user_id) in self.members

    def download(self, path: str) -> bytes:
        return b"\xff\xd8\xff fake"

    def update_bill(self, bill_id: str, fields: dict[str, Any]) -> None:
        self.bills[bill_id].update(fields)

    def replace_children(self, bill_id: str, items: list, products: list) -> None:
        self.items[bill_id], self.products[bill_id] = items, products

    def processing_batches(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for b in self.bills.values():
            if b.get("status") == "processing" and b.get("batch_id"):
                out.setdefault(b["batch_id"], []).append(b["id"])
        return out


@pytest.fixture
def env() -> tuple[TestClient, FakeRepo, FakeClient]:
    repo = FakeRepo()
    fake = FakeClient(tool_message(LAUNDRY))
    app.dependency_overrides[get_repo] = lambda: repo
    app.dependency_overrides[client_dep] = lambda: fake
    app.dependency_overrides[current_user_id] = lambda: "user-a"
    yield TestClient(app), repo, fake
    app.dependency_overrides.clear()


def test_extract_saves_bill_and_items(env) -> None:
    c, repo, _ = env
    r = c.post("/bills/b1/extract")
    assert r.status_code == 200, r.text
    b = repo.bills["b1"]
    assert b["status"] == "done" and b["bill_kind"] == "laundry"
    assert b["total"] == 240 and b["bill_date"] == "2026-11-03"
    assert b["needs_fix"] is False
    assert [i["name"] for i in repo.items["b1"]] == ["shirt", "trouser"]


def test_other_household_is_404(env) -> None:
    c, _, fake = env
    assert c.post("/bills/b2/extract").status_code == 404
    assert c.post("/bills/missing/extract").status_code == 404
    assert fake.messages.calls == []


def test_page_path_outside_household_rejected(env) -> None:
    c, _, fake = env
    assert c.post("/bills/b3/extract").status_code == 400
    assert fake.messages.calls == []


def test_model_failure_marks_bill_failed(env) -> None:
    c, repo, fake = env
    fake.messages.response = type("M", (), {"content": [], "usage": {}})()
    assert c.post("/bills/b1/extract").status_code == 502
    assert repo.bills["b1"]["status"] == "failed"


def test_batch_then_poll(env, monkeypatch) -> None:
    from types import SimpleNamespace

    from app.config import get_settings

    c, repo, fake = env
    r = c.post("/bills/batch", json={"bill_ids": ["b1"]})
    assert r.status_code == 200, r.text
    assert repo.bills["b1"]["batch_id"] == "msgbatch_test"
    assert fake.messages.batches.created[0]["custom_id"] == "b1"
    assert c.post("/bills/batch", json={"bill_ids": ["b2"]}).status_code == 404

    monkeypatch.setenv("CRON_SECRET", "s")
    get_settings.cache_clear()
    fake.messages.batches._results = [
        SimpleNamespace(
            custom_id="b1",
            result=SimpleNamespace(type="succeeded", message=tool_message(LAUNDRY)),
        )
    ]
    fake.messages.batches.status = "ended"
    out = c.post("/bills/jobs/poll-batches", headers={"X-Cron-Secret": "s"}).json()
    assert out["bills_done"] == 1
    assert repo.bills["b1"]["status"] == "done"


def test_electronics_products_dates() -> None:
    msg = tool_message(
        {
            "bill_kind": {"value": "electronics", "confidence": 0.9},
            "bill_date": {"value": "2026-01-31", "confidence": 0.9},
            "warranty_months": {"value": 13, "confidence": 0.9},
            "serial_no": {"value": "SN123", "confidence": 0.9},
            "items": [{"name": "Fridge", "amount": 30000}],
            "total": {"value": 30000, "confidence": 0.9},
        }
    )
    _, _, products = result_to_rows(parse_message(msg), "b9")
    assert products[0]["warranty_until"] == "2027-02-28"
    assert products[0]["serial_no"] == "SN123"


def test_add_months_clamps() -> None:
    from datetime import date

    assert _add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert _add_months(date(2026, 11, 15), 24) == date(2028, 11, 15)
