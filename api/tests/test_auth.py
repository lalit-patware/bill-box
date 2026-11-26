import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

SECRET = "x" * 32


@pytest.fixture
def hs256(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    get_settings.cache_clear()


def token(**over: object) -> str:
    claims = {"sub": "user-a", "aud": "authenticated", "exp": int(time.time()) + 60, **over}
    return jwt.encode(claims, SECRET, algorithm="HS256")


@pytest.mark.usefixtures("hs256")
def test_valid_token_reaches_handler() -> None:
    # Unknown batch → 404 means auth passed.
    r = TestClient(app).get("/batch/x", headers={"Authorization": f"Bearer {token()}"})
    assert r.status_code == 404


@pytest.mark.usefixtures("hs256")
@pytest.mark.parametrize(
    "bad",
    [
        {"exp": int(time.time()) - 10},
        {"aud": "anon"},
    ],
)
def test_bad_tokens_rejected(bad: dict) -> None:
    r = TestClient(app).get("/batch/x", headers={"Authorization": f"Bearer {token(**bad)}"})
    assert r.status_code == 401


@pytest.mark.usefixtures("hs256")
def test_wrong_signature_and_missing_header() -> None:
    forged = jwt.encode({"sub": "u", "aud": "authenticated", "exp": 9e9}, "y" * 32, "HS256")
    c = TestClient(app)
    assert c.get("/batch/x", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    assert c.get("/batch/x").status_code == 401
