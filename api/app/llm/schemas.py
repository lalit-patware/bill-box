"""Extraction schema shared by the live and batch paths.

Every scalar field is wrapped as {value, confidence} so the UI can show a
"Fix" chip only on low-confidence fields.
"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

LOW_CONFIDENCE = 0.7


class BillKind(StrEnum):
    retail_fashion = "retail_fashion"
    electronics = "electronics"
    recurring_milk = "recurring_milk"
    laundry = "laundry"
    textile_kaccha = "textile_kaccha"
    vendor_credit = "vendor_credit"
    medical_consult = "medical_consult"
    hospital = "hospital"
    general = "general"
    not_a_bill = "not_a_bill"


class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class FStr(Strict):
    value: str | None = None
    confidence: float = Field(0.0, ge=0, le=1)


class FNum(Strict):
    value: float | None = None
    confidence: float = Field(0.0, ge=0, le=1)


class FInt(Strict):
    value: int | None = None
    confidence: float = Field(0.0, ge=0, le=1)


class FBool(Strict):
    value: bool | None = None
    confidence: float = Field(0.0, ge=0, le=1)


class FKind(Strict):
    value: BillKind = BillKind.general
    confidence: float = Field(0.0, ge=0, le=1)


class LineItem(Strict):
    name: str
    qty: float | None = None
    unit: str | None = None
    rate: float | None = None
    amount: float | None = None
    confidence: float = Field(0.0, ge=0, le=1)


class MilkDay(Strict):
    day: int = Field(ge=1, le=31)
    litres: float | None = None  # None = absent / no delivery


class Extraction(Strict):
    """What the model returns (tool input). Dates are ISO yyyy-mm-dd."""

    bill_kind: FKind = FKind()
    vendor_name: FStr = FStr()
    vendor_phone: FStr = FStr()
    bill_date: FStr = FStr()
    bill_no: FStr = FStr()
    items: list[LineItem] = []
    subtotal: FNum = FNum()
    tax: FNum = FNum()
    total: FNum = FNum()
    language: FStr = FStr()
    is_handwritten: FBool = FBool()
    warranty_months: FInt = FInt()
    exchange_days: FInt = FInt()
    serial_no: FStr = FStr()
    patient_name: FStr = FStr()
    period_month: FStr = FStr()  # yyyy-mm for recurring_milk / monthly vendor bills
    milk_days: list[MilkDay] = []
    piece_count: FInt = FInt()  # laundry
    promised_date: FStr = FStr()  # laundry pickup / delivery date
    notes: FStr = FStr()


class Validation(Strict):
    items_sum: float | None = None
    total_mismatch: bool = False
    mismatch_amount: float | None = None
    line_mismatches: list[int] = []  # indexes where qty*rate != amount
    low_confidence_fields: list[str] = []


class Usage(Strict):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cost_inr: float = 0.0


class ExtractResult(Strict):
    extraction: Extraction
    validation: Validation
    usage: Usage
    prompt_version: str
    model: str
    raw: dict[str, Any] = {}


def extraction_tool_schema() -> dict[str, Any]:
    """JSON schema for the forced tool call."""
    schema = Extraction.model_json_schema()
    return schema
