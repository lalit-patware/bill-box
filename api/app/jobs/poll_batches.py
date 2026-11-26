"""Poll pending batches and store results. Called by cron via POST /jobs/poll-batches."""

from typing import Any

from app.llm.extractor import MessagesClient, batch_status, collect_batch
from app.llm.schemas import ExtractResult
from app.store import BatchStore


def poll_batches(store: BatchStore, client: MessagesClient | None = None) -> dict[str, Any]:
    summary: dict[str, Any] = {"checked": 0, "completed": []}
    for batch_id in store.pending_ids():
        summary["checked"] += 1
        if batch_status(batch_id, client) != "ended":
            continue
        results = collect_batch(batch_id, client)
        serialised = {
            cid: (r.model_dump(mode="json") if isinstance(r, ExtractResult) else {"error": r})
            for cid, r in results.items()
        }
        store.complete(batch_id, serialised)
        summary["completed"].append(batch_id)
        # Phase 4: send Web Push "Your N bills are ready" here.
    return summary
