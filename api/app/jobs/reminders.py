"""Hourly reminder delivery: Web Push first, email as fallback, in-app always.

Called by Supabase pg_cron → POST /bills/jobs/send-reminders (X-Cron-Secret).
The app's "Action needed" block shows the same deadlines, so a reminder that can't be
pushed or emailed is still visible in-app and is marked sent (no retry storm).
"""

import json
import logging
from typing import Any, Protocol

import httpx

from app.config import Settings, get_settings
from app.supa import Repo

log = logging.getLogger("billvault.reminders")


class Pusher(Protocol):
    def send(self, subscription: dict[str, Any], payload: dict[str, str]) -> int:
        """Return HTTP status from the push service (201 ok, 404/410 = gone)."""
        ...


class Mailer(Protocol):
    def send(self, to: list[str], subject: str, text: str) -> bool: ...


class WebPusher:
    def __init__(self, settings: Settings) -> None:
        self.private_key = settings.vapid_private_key
        self.claims = {"sub": settings.vapid_subject}

    def send(self, subscription: dict[str, Any], payload: dict[str, str]) -> int:
        from pywebpush import WebPushException, webpush

        info = {"endpoint": subscription["endpoint"], "keys": subscription["keys"]}
        try:
            r = webpush(
                info,
                data=json.dumps(payload),
                vapid_private_key=self.private_key,
                vapid_claims=dict(self.claims),
                ttl=24 * 3600,
                timeout=10,
            )
            return getattr(r, "status_code", 201)
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", 0) if exc.response is not None else 0
            log.warning("push failed: %s", status)
            return status


class ResendMailer:
    def __init__(self, settings: Settings) -> None:
        self.key = settings.resend_api_key
        self.sender = settings.resend_from

    def send(self, to: list[str], subject: str, text: str) -> bool:
        try:
            r = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.key}"},
                json={"from": self.sender, "to": to, "subject": subject, "text": text},
                timeout=10,
            )
            return r.status_code < 300
        except httpx.HTTPError:
            log.warning("email send failed")
            return False


def default_pusher(settings: Settings | None = None) -> Pusher | None:
    s = settings or get_settings()
    return WebPusher(s) if s.vapid_private_key else None


def default_mailer(settings: Settings | None = None) -> Mailer | None:
    s = settings or get_settings()
    return ResendMailer(s) if s.resend_api_key and s.resend_from else None


def send_due_reminders(
    repo: Repo, pusher: Pusher | None, mailer: Mailer | None, app_url: str, limit: int = 100
) -> dict[str, int]:
    summary = {"due": 0, "pushed": 0, "emailed": 0, "in_app_only": 0, "subs_removed": 0}
    for r in repo.due_reminders(limit):
        summary["due"] += 1
        url = f"{app_url.rstrip('/')}{r.get('url') or '/'}"
        payload = {
            "title": r["title"] or "Reminder",
            "body": r["body"] or "",
            "url": r.get("url") or "/",
        }

        delivered = False
        if pusher is not None:
            for sub in repo.push_subscriptions(r["user_ids"]):
                status = pusher.send(sub, payload)
                if status in (404, 410):  # subscription expired / unsubscribed
                    repo.delete_push_subscription(sub["endpoint"])
                    summary["subs_removed"] += 1
                elif 200 <= status < 300:
                    delivered = True

        channel = "push"
        if delivered:
            summary["pushed"] += 1
        elif mailer is not None and r.get("emails"):
            text = f"{payload['body']}\n\nOpen: {url}"
            if mailer.send(r["emails"], payload["title"], text):
                channel = "email"
                summary["emailed"] += 1
            else:
                summary["in_app_only"] += 1
        else:
            summary["in_app_only"] += 1
        repo.mark_reminder_sent(r["id"], channel)
    return summary
