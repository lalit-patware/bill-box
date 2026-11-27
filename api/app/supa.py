"""Minimal Supabase REST access with the service role (PostgREST + Storage).

The service role bypasses RLS, so every caller MUST check membership first
(`is_member`) before reading or writing a household's data.
"""

from datetime import UTC, datetime
from typing import Any, Protocol

import httpx

from app.config import get_settings

BUCKET = "bills"


def service_headers(key: str) -> dict[str, str]:
    """New secret keys (sb_secret_...) are not JWTs and must only go in `apikey`;
    the gateway then injects a service_role JWT. Legacy service_role JWTs also go in
    Authorization."""
    if key.startswith("sb_"):
        return {"apikey": key}
    return {"apikey": key, "Authorization": f"Bearer {key}"}


class Repo(Protocol):
    def get_bill(self, bill_id: str) -> dict[str, Any] | None: ...
    def is_member(self, household_id: str, user_id: str) -> bool: ...
    def download(self, path: str) -> bytes: ...
    def update_bill(self, bill_id: str, fields: dict[str, Any]) -> None: ...
    def replace_children(
        self, bill_id: str, items: list[dict[str, Any]], products: list[dict[str, Any]]
    ) -> None: ...
    def processing_batches(self) -> dict[str, list[str]]: ...
    def ai_pending_bills(self, limit: int) -> list[dict[str, Any]]: ...
    def after_saved(self, bill_id: str) -> None: ...
    def set_exchange_days(self, bill_id: str, days: int) -> None: ...
    def due_reminders(self, limit: int) -> list[dict[str, Any]]: ...
    def push_subscriptions(self, user_ids: list[str]) -> list[dict[str, Any]]: ...
    def delete_push_subscription(self, endpoint: str) -> None: ...
    def mark_reminder_sent(self, reminder_id: str, channel: str) -> None: ...
    def charge_scan(self, bill_id: str) -> str: ...
    def create_payment(self, row: dict[str, Any]) -> None: ...
    def get_payment(self, order_id: str) -> dict[str, Any] | None: ...
    def apply_payment(self, order_id: str, payment_id: str) -> bool: ...


class SupabaseRepo:
    def __init__(self, http: httpx.Client | None = None) -> None:
        s = get_settings()
        if not (s.supabase_url and s.supabase_service_role_key):
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self.http = http or httpx.Client(
            base_url=s.supabase_url.rstrip("/"),
            headers=service_headers(s.supabase_service_role_key),
            timeout=30,
        )

    # PostgREST -----------------------------------------------------------
    def _select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        r = self.http.get(f"/rest/v1/{table}", params=params)
        r.raise_for_status()
        return r.json()

    def get_bill(self, bill_id: str) -> dict[str, Any] | None:
        rows = self._select("bills", {"id": f"eq.{bill_id}", "select": "*"})
        return rows[0] if rows else None

    def is_member(self, household_id: str, user_id: str) -> bool:
        rows = self._select(
            "members",
            {"household_id": f"eq.{household_id}", "user_id": f"eq.{user_id}", "select": "role"},
        )
        return bool(rows)

    def update_bill(self, bill_id: str, fields: dict[str, Any]) -> None:
        r = self.http.patch(
            "/rest/v1/bills",
            params={"id": f"eq.{bill_id}"},
            json=fields,
            headers={"Prefer": "return=minimal"},
        )
        r.raise_for_status()

    def replace_children(
        self, bill_id: str, items: list[dict[str, Any]], products: list[dict[str, Any]]
    ) -> None:
        for table, rows in (("bill_items", items), ("products", products)):
            self.http.delete(f"/rest/v1/{table}", params={"bill_id": f"eq.{bill_id}"})
            if rows:
                r = self.http.post(
                    f"/rest/v1/{table}", json=rows, headers={"Prefer": "return=minimal"}
                )
                r.raise_for_status()

    def processing_batches(self) -> dict[str, list[str]]:
        rows = self._select(
            "bills",
            {"status": "eq.processing", "batch_id": "not.is.null", "select": "id,batch_id"},
        )
        out: dict[str, list[str]] = {}
        for row in rows:
            out.setdefault(row["batch_id"], []).append(row["id"])
        return out

    def ai_pending_bills(self, limit: int) -> list[dict[str, Any]]:
        return self._select(
            "bills",
            {
                "ai_pending": "is.true",
                "select": "id,household_id,page_paths,hints",
                # Bills waiting for scans go last so they never starve the others.
                "order": "quota_blocked.asc,created_at.asc",
                "limit": str(limit),
            },
        )

    def _rpc(self, fn: str, args: dict[str, Any]) -> Any:
        r = self.http.post(f"/rest/v1/rpc/{fn}", json=args)
        r.raise_for_status()
        return r.json() if r.content else None

    def after_saved(self, bill_id: str) -> None:
        """Vendor link, duplicate flag, exchange default, ledger and reminders (SQL)."""
        self._rpc("after_bill_saved", {"p_bill": bill_id})

    def set_exchange_days(self, bill_id: str, days: int) -> None:
        self._rpc("set_vendor_exchange_days", {"p_bill": bill_id, "p_days": days})

    def due_reminders(self, limit: int) -> list[dict[str, Any]]:
        return self._rpc("due_reminders", {"p_limit": limit}) or []

    def push_subscriptions(self, user_ids: list[str]) -> list[dict[str, Any]]:
        if not user_ids:
            return []
        return self._select(
            "push_subscriptions",
            {"user_id": f"in.({','.join(user_ids)})", "select": "endpoint,keys"},
        )

    def delete_push_subscription(self, endpoint: str) -> None:
        self.http.delete("/rest/v1/push_subscriptions", params={"endpoint": f"eq.{endpoint}"})

    def charge_scan(self, bill_id: str) -> str:
        """'free' | 'credit' | 'already' | 'none' (out of scans). Once per bill."""
        return str(self._rpc("charge_scan", {"p_bill": bill_id}))

    def create_payment(self, row: dict[str, Any]) -> None:
        r = self.http.post("/rest/v1/payments", json=row, headers={"Prefer": "return=minimal"})
        r.raise_for_status()

    def get_payment(self, order_id: str) -> dict[str, Any] | None:
        rows = self._select("payments", {"razorpay_order_id": f"eq.{order_id}", "select": "*"})
        return rows[0] if rows else None

    def apply_payment(self, order_id: str, payment_id: str) -> bool:
        return bool(self._rpc("apply_payment", {"p_order": order_id, "p_payment": payment_id}))

    def mark_reminder_sent(self, reminder_id: str, channel: str) -> None:
        r = self.http.patch(
            "/rest/v1/reminders",
            params={"id": f"eq.{reminder_id}"},
            json={"sent_at": datetime.now(UTC).isoformat(), "channel": channel},
            headers={"Prefer": "return=minimal"},
        )
        r.raise_for_status()

    # Storage -------------------------------------------------------------
    def download(self, path: str) -> bytes:
        r = self.http.get(f"/storage/v1/object/{BUCKET}/{path}")
        r.raise_for_status()
        return r.content


def get_repo() -> Repo:
    return SupabaseRepo()
