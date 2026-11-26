from types import SimpleNamespace

import pytest

from app.jobs.poll_batches import poll_batches
from app.llm.extractor import (
    ExtractionError,
    collect_batch,
    extract_live,
    parse_message,
    submit_batch,
    usage_from,
)
from app.llm.request_builder import BillFile
from app.store import BatchStore
from tests.conftest import LAUNDRY, FakeClient, tool_message

JPEG = BillFile(b"\xff\xd8\xff fake", "image/jpeg")


def test_extract_live_parses_and_validates() -> None:
    client = FakeClient(tool_message(LAUNDRY))
    r = extract_live([JPEG], client=client)
    assert r.extraction.bill_kind.value == "laundry"
    assert r.extraction.piece_count.value == 12
    assert not r.validation.total_mismatch
    assert r.prompt_version == "extract_v1"
    assert client.messages.calls[0]["tool_choice"]["name"] == "record_bill"


def test_missing_tool_call_raises() -> None:
    msg = SimpleNamespace(content=[SimpleNamespace(type="text", text="hi")], usage={})
    with pytest.raises(ExtractionError):
        parse_message(msg)


def test_unknown_extra_fields_are_ignored() -> None:
    r = parse_message(tool_message({**LAUNDRY, "surprise": 1}))
    assert r.extraction.total.value == 240


def test_cost_accounts_for_cache_and_batch() -> None:
    raw = {"input_tokens": 2000, "output_tokens": 600, "cache_read_input_tokens": 1500}
    live = usage_from(raw)
    batch = usage_from(raw, batch=True)
    # (2000 + 150) * 0.10/M + 600 * 0.50/M = $0.000515 → ₹0.0453
    assert live.cost_inr == pytest.approx(0.0453, abs=1e-4)
    assert batch.cost_inr == pytest.approx(live.cost_inr / 2, abs=1e-4)


def test_batch_submit_collect_and_poll(tmp_path) -> None:
    results = [
        SimpleNamespace(
            custom_id="bill-1",
            result=SimpleNamespace(type="succeeded", message=tool_message(LAUNDRY)),
        ),
        SimpleNamespace(custom_id="bill-2", result=SimpleNamespace(type="errored")),
    ]
    client = FakeClient(batch_results=results)
    batch_id = submit_batch([("bill-1", [JPEG], None), ("bill-2", [JPEG], None)], client)
    assert batch_id == "msgbatch_test"
    sent = client.messages.batches.created
    assert [r["custom_id"] for r in sent] == ["bill-1", "bill-2"]
    assert sent[0]["params"]["model"] == "claude-haiku-5-5"

    collected = collect_batch(batch_id, client)
    assert collected["bill-2"] == "errored"
    assert collected["bill-1"].usage.cost_inr < usage_from(tool_message(LAUNDRY).usage).cost_inr

    store = BatchStore(str(tmp_path / "b.json"))
    store.create(batch_id, ["bill-1", "bill-2"])
    assert poll_batches(store, client)["completed"] == []  # still in progress
    client.messages.batches.status = "ended"
    assert poll_batches(store, client)["completed"] == [batch_id]
    entry = store.get(batch_id)
    assert entry["status"] == "ended"
    assert entry["results"]["bill-1"]["extraction"]["total"]["value"] == 240
    assert entry["results"]["bill-2"] == {"error": "errored"}
