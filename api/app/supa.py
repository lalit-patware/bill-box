"""Minimal Supabase REST access with the service role (PostgREST + Storage).

The service role bypasses RLS, so every caller MUST check membership first
(`is_member`) before reading or writing a household's data.
"""

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
                "order": "created_at.asc",
                "limit": str(limit),
            },
        )

    # Storage -------------------------------------------------------------
    def download(self, path: str) -> bytes:
        r = self.http.get(f"/storage/v1/object/{BUCKET}/{path}")
        r.raise_for_status()
        return r.content


def get_repo() -> Repo:
    return SupabaseRepo()
