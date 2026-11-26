"""Prices live here only (the PWA reads them from GET /payments/plans)."""

from pydantic import BaseModel

FREE_SCANS_PER_MONTH = 5  # keep in sync with private.free_limit() in SQL


class Plan(BaseModel):
    id: str
    name: str
    amount_paise: int
    credits: int
    family: bool = False  # 1 year family plan (up to 6 members)


PLANS: dict[str, Plan] = {
    "pack25": Plan(id="pack25", name="25 scans", amount_paise=1000, credits=25),
    "family": Plan(id="family", name="Family 1 year", amount_paise=9900, credits=300, family=True),
}
