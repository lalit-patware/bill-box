import pytest

from app.llm.request_builder import TOOL_NAME, BillFile, extract_request, load_prompt
from app.llm.schemas import BillKind

JPEG = BillFile(b"\xff\xd8\xff fake", "image/jpeg")
PDF = BillFile(b"%PDF-1.4 fake", "application/pdf")


def test_forces_tool_and_uses_haiku() -> None:
    p = extract_request([JPEG])
    assert p["model"] == "claude-haiku-5-5"
    assert p["tool_choice"] == {"type": "tool", "name": TOOL_NAME}
    assert p["temperature"] == 0
    assert p["tools"][0]["name"] == TOOL_NAME


def test_system_prompt_is_cached() -> None:
    p = extract_request([JPEG])
    assert p["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert p["system"][0]["text"] == load_prompt()


def test_image_and_pdf_blocks() -> None:
    content = extract_request([JPEG, PDF])["messages"][0]["content"]
    assert [b["type"] for b in content] == ["image", "document", "text"]
    assert content[1]["source"]["media_type"] == "application/pdf"
    assert "2 page(s)" in content[2]["text"]


def test_hints_are_passed() -> None:
    text = extract_request([JPEG], {"upi": {"pa": "ramesh@upi"}})["messages"][0]["content"][-1]
    assert "ramesh@upi" in text["text"]


def test_same_params_for_live_and_batch() -> None:
    """Batch requests reuse the exact live params (one builder)."""
    assert extract_request([JPEG]) == extract_request([JPEG])


def test_schema_lists_every_bill_kind() -> None:
    schema = extract_request([JPEG])["tools"][0]["input_schema"]
    kinds = set(schema["$defs"]["BillKind"]["enum"])
    assert kinds == {k.value for k in BillKind}


def test_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        extract_request([])
    with pytest.raises(ValueError):
        BillFile(b"x", "image/heic")


def test_prompt_forbids_prescription_reading() -> None:
    assert "do **not** read or interpret medicine names" in load_prompt()
