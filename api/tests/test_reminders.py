from typing import Any

from app.jobs.reminders import send_due_reminders


class Repo:
    def __init__(self, due: list[dict[str, Any]], subs: dict[str, list[dict[str, Any]]]) -> None:
        self.due = due
        self.subs = subs
        self.sent: dict[str, str] = {}
        self.deleted: list[str] = []

    def due_reminders(self, limit: int) -> list[dict[str, Any]]:
        return self.due[:limit]

    def push_subscriptions(self, user_ids: list[str]) -> list[dict[str, Any]]:
        return [s for u in user_ids for s in self.subs.get(u, [])]

    def delete_push_subscription(self, endpoint: str) -> None:
        self.deleted.append(endpoint)

    def mark_reminder_sent(self, reminder_id: str, channel: str) -> None:
        self.sent[reminder_id] = channel


class Pusher:
    def __init__(self, statuses: dict[str, int]) -> None:
        self.statuses = statuses
        self.payloads: list[dict[str, str]] = []

    def send(self, subscription: dict[str, Any], payload: dict[str, str]) -> int:
        self.payloads.append(payload)
        return self.statuses[subscription["endpoint"]]


class Mailer:
    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.mails: list[tuple[list[str], str, str]] = []

    def send(self, to: list[str], subject: str, text: str) -> bool:
        self.mails.append((to, subject, text))
        return self.ok


def reminder(rid: str, users: list[str], emails: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": rid,
        "kind": "warranty",
        "title": "Warranty ends in 7 days",
        "body": "Fridge: warranty until 20 Dec 2026",
        "url": "/bill/f1",
        "user_ids": users,
        "emails": emails or [],
    }


def sub(endpoint: str) -> dict[str, Any]:
    return {"endpoint": endpoint, "keys": {"p256dh": "x", "auth": "y"}}


def test_push_then_email_then_in_app() -> None:
    repo = Repo(
        [
            reminder("r1", ["u1"]),  # phone subscribed → push
            reminder("r2", ["u2"], ["u2@x.in"]),  # no subscription → email
            reminder("r3", ["u3"]),  # nothing → in-app only
        ],
        {"u1": [sub("https://push/ok")]},
    )
    pusher, mailer = Pusher({"https://push/ok": 201}), Mailer()
    out = send_due_reminders(repo, pusher, mailer, "https://app.example")
    assert out == {"due": 3, "pushed": 1, "emailed": 1, "in_app_only": 1, "subs_removed": 0}
    assert repo.sent == {"r1": "push", "r2": "email", "r3": "push"}
    assert pusher.payloads[0] == {
        "title": "Warranty ends in 7 days",
        "body": "Fridge: warranty until 20 Dec 2026",
        "url": "/bill/f1",
    }
    assert mailer.mails[0][2].endswith("Open: https://app.example/bill/f1")


def test_expired_subscription_removed_and_falls_back_to_email() -> None:
    repo = Repo([reminder("r1", ["u1"], ["u1@x.in"])], {"u1": [sub("https://push/gone")]})
    out = send_due_reminders(repo, Pusher({"https://push/gone": 410}), Mailer(), "https://a")
    assert repo.deleted == ["https://push/gone"]
    assert out["emailed"] == 1 and out["subs_removed"] == 1


def test_works_with_nothing_configured() -> None:
    repo = Repo([reminder("r1", ["u1"], ["a@b.c"])], {"u1": [sub("https://p")]})
    out = send_due_reminders(repo, None, None, "https://a")
    assert out["in_app_only"] == 1 and repo.sent == {"r1": "push"}


def test_real_webpush_signing_path() -> None:
    """WebPusher builds a valid encrypted request; network call is faked."""
    import base64

    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    import app.jobs.reminders as mod
    from app.config import Settings

    vapid = ec.generate_private_key(ec.SECP256R1())
    raw = vapid.private_numbers().private_value.to_bytes(32, "big")
    b64 = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    browser = ec.generate_private_key(ec.SECP256R1()).public_key()
    p256dh = (
        base64.urlsafe_b64encode(
            browser.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        )
        .decode()
        .rstrip("=")
    )
    auth = base64.urlsafe_b64encode(b"0123456789abcdef").decode().rstrip("=")

    sent: dict[str, Any] = {}

    class Resp:
        status_code = 201
        text = ""
        headers: dict[str, str] = {}

    def fake_post(url: str, data: bytes, headers: dict[str, str], timeout: float) -> Resp:
        sent.update(url=url, headers=headers, size=len(data))
        return Resp()

    import requests

    orig = requests.post
    requests.post = fake_post  # type: ignore[assignment]
    try:
        pusher = mod.WebPusher(Settings(vapid_private_key=b64, vapid_subject="mailto:a@b.c"))
        status = pusher.send(
            {
                "endpoint": "https://fcm.googleapis.com/fcm/send/x",
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            {"title": "T", "body": "B", "url": "/"},
        )
    finally:
        requests.post = orig  # type: ignore[assignment]
    assert status == 201
    assert sent["headers"]["Authorization"].startswith("vapid t=")
    assert sent["headers"]["Content-Encoding"] == "aes128gcm"
