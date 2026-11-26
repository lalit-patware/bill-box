"""Arithmetic checks and low-confidence detection. Pure functions, no I/O."""

from app.llm.schemas import (
    LOW_CONFIDENCE,
    BillKind,
    Extraction,
    FBool,
    FInt,
    FKind,
    FNum,
    FStr,
    Validation,
)

TOLERANCE_INR = 1.0

# Fields worth showing a Fix chip for, per bill kind (others stay quiet).
_KEY_FIELDS: dict[BillKind, tuple[str, ...]] = {
    BillKind.electronics: ("vendor_name", "bill_date", "total", "warranty_months", "serial_no"),
    BillKind.retail_fashion: ("vendor_name", "bill_date", "total"),
    BillKind.recurring_milk: ("vendor_name", "period_month", "total"),
    BillKind.laundry: ("vendor_name", "bill_no", "piece_count"),
    BillKind.hospital: ("vendor_name", "bill_date", "total", "patient_name"),
    BillKind.medical_consult: ("vendor_name", "bill_date", "total"),
}
_DEFAULT_KEY_FIELDS = ("vendor_name", "bill_date", "total")


def _milk_sum(ex: Extraction) -> float | None:
    """For milk cards: litres × rate, if the card has daily marks and a rate."""
    litres = [d.litres for d in ex.milk_days if d.litres is not None]
    rate = next((i.rate for i in ex.items if i.rate is not None), None)
    if not litres or rate is None:
        return None
    return round(sum(litres) * rate, 2)


def _items_sum(ex: Extraction) -> float | None:
    amounts = [i.amount for i in ex.items if i.amount is not None]
    return round(sum(amounts), 2) if amounts else None


def validate(ex: Extraction) -> Validation:
    v = Validation()

    for idx, item in enumerate(ex.items):
        if (
            item.qty is not None
            and item.rate is not None
            and item.amount is not None
            and abs(item.qty * item.rate - item.amount) > TOLERANCE_INR
        ):
            v.line_mismatches.append(idx)

    computed = _milk_sum(ex) if ex.bill_kind.value == BillKind.recurring_milk else None
    if computed is None:
        computed = _items_sum(ex)
    v.items_sum = computed

    total = ex.total.value
    if computed is not None and total is not None:
        # Items may be pre-tax; accept either items == total or items + tax == total.
        tax = ex.tax.value or 0.0
        diff = min(abs(computed - total), abs(computed + tax - total))
        if diff > TOLERANCE_INR:
            v.total_mismatch = True
            v.mismatch_amount = round(total - computed, 2)

    kind = ex.bill_kind.value
    for name in _KEY_FIELDS.get(kind, _DEFAULT_KEY_FIELDS):
        field = getattr(ex, name)
        if isinstance(field, FStr | FNum | FInt | FBool | FKind) and (
            field.value is None or field.confidence < LOW_CONFIDENCE
        ):
            v.low_confidence_fields.append(name)
    if ex.bill_kind.confidence < LOW_CONFIDENCE:
        v.low_confidence_fields.append("bill_kind")

    return v
