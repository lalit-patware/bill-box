"""Compare an Extraction against an expected.json. Pure functions (unit-tested)."""

import re
from difflib import SequenceMatcher
from typing import Any

from app.llm.schemas import Extraction

AMOUNT_TOLERANCE = 1.0
NAME_SIMILARITY = 0.8

# Fields scored when present in expected.json, and how to compare them.
NUMERIC_FIELDS = {"total", "subtotal", "tax", "warranty_months", "exchange_days", "piece_count"}
EXACT_FIELDS = {"bill_kind", "bill_date", "period_month", "promised_date", "is_handwritten"}
FUZZY_FIELDS = {"vendor_name", "patient_name"}
CODE_FIELDS = {"bill_no", "serial_no", "vendor_phone"}

GATES = {"total": 0.90, "bill_date": 0.90, "vendor_name": 0.90, "bill_kind": 0.95}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9ऀ-ॿ]+", " ", s.lower()).strip()


def _code(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", s).upper()


def field_value(ex: Extraction, name: str) -> Any:
    v = getattr(ex, name).value
    return v.value if hasattr(v, "value") else v  # BillKind enum → str


def match(name: str, expected: Any, actual: Any) -> bool:
    if expected is None:
        return actual is None
    if actual is None:
        return False
    if name in NUMERIC_FIELDS:
        try:
            return abs(float(expected) - float(actual)) <= AMOUNT_TOLERANCE
        except (TypeError, ValueError):
            return False
    if name in FUZZY_FIELDS:
        e, a = _norm(str(expected)), _norm(str(actual))
        return e in a or a in e or SequenceMatcher(None, e, a).ratio() >= NAME_SIMILARITY
    if name in CODE_FIELDS:
        return _code(str(expected)) == _code(str(actual))
    return str(expected).strip().lower() == str(actual).strip().lower()


SCORABLE = NUMERIC_FIELDS | EXACT_FIELDS | FUZZY_FIELDS | CODE_FIELDS


def score(ex: Extraction, expected: dict[str, Any]) -> dict[str, bool]:
    """Return {field: correct?} for every scorable field in expected."""
    return {
        name: match(name, expected[name], field_value(ex, name))
        for name in expected
        if name in SCORABLE
    }


def summarise(rows: list[dict[str, bool]]) -> dict[str, dict[str, float]]:
    totals: dict[str, list[bool]] = {}
    for row in rows:
        for name, ok in row.items():
            totals.setdefault(name, []).append(ok)
    return {
        name: {"n": len(v), "accuracy": round(sum(v) / len(v), 3)}
        for name, v in sorted(totals.items())
    }


def gate(summary: dict[str, dict[str, float]]) -> dict[str, bool]:
    return {
        name: summary.get(name, {}).get("accuracy", 0.0) >= threshold
        for name, threshold in GATES.items()
    }
