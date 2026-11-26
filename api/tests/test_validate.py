from app.llm.schemas import Extraction
from app.llm.validate import validate
from tests.conftest import LAUNDRY


def ex(**kw: object) -> Extraction:
    return Extraction.model_validate(kw)


def test_clean_bill_passes() -> None:
    v = validate(Extraction.model_validate(LAUNDRY))
    assert v.items_sum == 240
    assert not v.total_mismatch
    assert v.low_confidence_fields == []


def test_total_mismatch_flagged() -> None:
    v = validate(
        ex(
            items=[{"name": "a", "amount": 100}, {"name": "b", "amount": 50}],
            total={"value": 170, "confidence": 0.9},
        )
    )
    assert v.total_mismatch
    assert v.mismatch_amount == 20


def test_items_plus_tax_equals_total_is_ok() -> None:
    v = validate(
        ex(
            items=[{"name": "shirt", "amount": 1000}],
            tax={"value": 120, "confidence": 0.9},
            total={"value": 1120, "confidence": 0.9},
        )
    )
    assert not v.total_mismatch


def test_line_mismatch() -> None:
    v = validate(ex(items=[{"name": "saree", "qty": 2, "rate": 450, "amount": 950}]))
    assert v.line_mismatches == [0]


def test_milk_card_recomputed_from_litres() -> None:
    days = [{"day": d, "litres": 2} for d in range(1, 30)] + [{"day": 30, "litres": None}]
    v = validate(
        ex(
            bill_kind={"value": "recurring_milk", "confidence": 0.95},
            items=[{"name": "milk", "unit": "L", "rate": 64}],
            milk_days=days,
            total={"value": 3712, "confidence": 0.9},
        )
    )
    assert v.items_sum == 29 * 2 * 64  # 3712
    assert not v.total_mismatch


def test_milk_card_wrong_total() -> None:
    days = [{"day": d, "litres": 2} for d in range(1, 29)]
    v = validate(
        ex(
            bill_kind={"value": "recurring_milk", "confidence": 0.95},
            items=[{"name": "milk", "rate": 64}],
            milk_days=days,
            total={"value": 3712, "confidence": 0.9},
        )
    )
    assert v.total_mismatch
    assert v.mismatch_amount == 3712 - 28 * 2 * 64


def test_low_confidence_and_missing_key_fields() -> None:
    v = validate(
        ex(
            bill_kind={"value": "electronics", "confidence": 0.5},
            vendor_name={"value": "Croma", "confidence": 0.95},
            bill_date={"value": "2026-10-01", "confidence": 0.4},
            total={"value": 54999, "confidence": 0.9},
        )
    )
    assert set(v.low_confidence_fields) == {
        "bill_date",
        "warranty_months",
        "serial_no",
        "bill_kind",
    }
