"""Single builder for Messages API params, shared by the live and batch paths."""

import base64
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.llm.schemas import extraction_tool_schema

PROMPT_VERSION = "extract_v1"
TOOL_NAME = "record_bill"
PROMPTS_DIR = Path(__file__).parent / "prompts"

SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
PDF_TYPE = "application/pdf"


@dataclass(frozen=True)
class BillFile:
    data: bytes
    media_type: str

    def __post_init__(self) -> None:
        if self.media_type not in SUPPORTED_IMAGE_TYPES | {PDF_TYPE}:
            raise ValueError(f"Unsupported media type: {self.media_type}")


@lru_cache
def load_prompt(version: str = PROMPT_VERSION) -> str:
    return (PROMPTS_DIR / f"{version}.md").read_text(encoding="utf-8")


def _file_block(f: BillFile) -> dict[str, Any]:
    b64 = base64.standard_b64encode(f.data).decode("ascii")
    block_type = "document" if f.media_type == PDF_TYPE else "image"
    return {
        "type": block_type,
        "source": {"type": "base64", "media_type": f.media_type, "data": b64},
    }


def extract_request(
    files: list[BillFile],
    hints: dict[str, Any] | None = None,
    prompt_version: str = PROMPT_VERSION,
) -> dict[str, Any]:
    """Build Messages API params. Identical for client.messages.create and batch requests."""
    if not files:
        raise ValueError("At least one file is required")

    settings = get_settings()
    content: list[dict[str, Any]] = [_file_block(f) for f in files]
    text = f"{len(files)} page(s) of one bill."
    if hints:
        text += "\nHints decoded from barcodes/QR on device:\n" + json.dumps(
            hints, ensure_ascii=False
        )
    text += f"\nCall {TOOL_NAME} once."
    content.append({"type": "text", "text": text})

    return {
        "model": settings.anthropic_model,
        "max_tokens": settings.max_output_tokens,
        "temperature": 0,
        # Cache prefix order is tools → system → messages, so one breakpoint on the
        # system block caches both the tool schema and the prompt.
        "system": [
            {
                "type": "text",
                "text": load_prompt(prompt_version),
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "tools": [
            {
                "name": TOOL_NAME,
                "description": "Record the structured data extracted from the bill.",
                "input_schema": extraction_tool_schema(),
            }
        ],
        "tool_choice": {"type": "tool", "name": TOOL_NAME},
        "messages": [{"role": "user", "content": content}],
    }
