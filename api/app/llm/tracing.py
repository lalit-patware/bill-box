"""Optional Langfuse tracing. No-op when keys are not set.

Only metadata is traced (prompt version, tokens, cost, latency). Bill images and
extracted content are never sent, per CLAUDE.md conventions.
"""

import logging
from typing import Any

from app.config import get_settings

log = logging.getLogger("billvault.llm")

_client: Any = None


def _langfuse() -> Any:
    global _client
    s = get_settings()
    if not (s.langfuse_public_key and s.langfuse_secret_key):
        return None
    if _client is None:
        try:
            from langfuse import Langfuse  # type: ignore[import-not-found]

            _client = Langfuse(
                public_key=s.langfuse_public_key,
                secret_key=s.langfuse_secret_key,
                host=s.langfuse_host,
            )
        except Exception:  # noqa: BLE001 - tracing must never break extraction
            log.warning("Langfuse unavailable; tracing disabled")
            return None
    return _client


def trace_extraction(meta: dict[str, Any]) -> None:
    log.info("extraction %s", {k: meta[k] for k in sorted(meta)})
    lf = _langfuse()
    if lf is None:
        return
    try:
        lf.trace(name="bill_extraction", metadata=meta)
    except Exception:  # noqa: BLE001
        log.warning("Langfuse trace failed", exc_info=True)
