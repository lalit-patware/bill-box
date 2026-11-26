"""Tiny JSON-file store for batch jobs.

Temporary until Supabase lands in Phase 2 (bills table with status=processing).
Single-process only; good enough for local dev and the eval harness.
"""

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import get_settings

_lock = threading.Lock()


class BatchStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = Path(path or get_settings().batch_store_path)

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def create(self, batch_id: str, custom_ids: list[str]) -> None:
        with _lock:
            data = self._read()
            data[batch_id] = {
                "status": "in_progress",
                "created_at": datetime.now(UTC).isoformat(),
                "custom_ids": custom_ids,
                "results": {},
            }
            self._write(data)

    def get(self, batch_id: str) -> dict[str, Any] | None:
        with _lock:
            return self._read().get(batch_id)

    def pending_ids(self) -> list[str]:
        with _lock:
            return [k for k, v in self._read().items() if v["status"] != "ended"]

    def complete(self, batch_id: str, results: dict[str, Any]) -> None:
        with _lock:
            data = self._read()
            entry = data.setdefault(batch_id, {"custom_ids": list(results)})
            entry["status"] = "ended"
            entry["ended_at"] = datetime.now(UTC).isoformat()
            entry["results"] = results
            self._write(data)
