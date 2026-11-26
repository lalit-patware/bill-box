from fastapi.testclient import TestClient

from app.auth import current_user_id
from app.main import app
from app.routers.extraction import client_dep
from tests.conftest import LAUNDRY, FakeClient, tool_message


def make(client: FakeClient) -> TestClient:
    app.dependency_overrides[client_dep] = lambda: client
    app.dependency_overrides[current_user_id] = lambda: "user-a"
    return TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def jpg(name: str = "bill.jpg", data: bytes = b"\xff\xd8\xff fake") -> tuple:
    return ("files", (name, data, "image/jpeg"))


def test_health() -> None:
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_extract_ok_with_hints() -> None:
    fake = FakeClient(tool_message(LAUNDRY))
    r = make(fake).post("/extract", files=[jpg()], data={"hints": '{"upi": {"pa": "x@upi"}}'})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["extraction"]["bill_kind"]["value"] == "laundry"
    assert body["validation"]["total_mismatch"] is False
    assert "x@upi" in fake.messages.calls[0]["messages"][0]["content"][-1]["text"]


def test_extract_rejects_bad_type_size_and_count() -> None:
    c = make(FakeClient(tool_message(LAUNDRY)))
    assert c.post("/extract", files=[("files", ("a.heic", b"x", "image/heic"))]).status_code == 415
    big = b"\xff" * (5 * 1024 * 1024 + 1)
    assert c.post("/extract", files=[jpg(data=big)]).status_code == 413
    assert c.post("/extract", files=[jpg()] * 4).status_code == 400
    assert c.post("/extract", files=[jpg()], data={"hints": "nope"}).status_code == 400


def test_batch_flow() -> None:
    fake = FakeClient()
    c = make(fake)
    r = c.post("/batch", files=[jpg("a.jpg"), jpg("b.jpg")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "processing" and len(body["custom_ids"]) == 2
    assert c.get(f"/batch/{body['batch_id']}").json()["status"] == "in_progress"
    assert c.get("/batch/unknown").status_code == 404


def test_extract_requires_login() -> None:
    app.dependency_overrides[client_dep] = lambda: FakeClient(tool_message(LAUNDRY))
    r = TestClient(app).post("/extract", files=[jpg()])
    assert r.status_code == 401


def test_jobs_require_cron_secret(monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("CRON_SECRET", "s3cret")
    get_settings.cache_clear()
    c = make(FakeClient())
    assert c.post("/jobs/poll-batches").status_code == 401
    assert c.post("/jobs/poll-batches", headers={"X-Cron-Secret": "nope"}).status_code == 401
    assert c.post("/jobs/poll-batches", headers={"X-Cron-Secret": "s3cret"}).status_code == 200
