from app.llm.schemas import Extraction
from eval.scoring import gate, match, score, summarise
from tests.conftest import LAUNDRY


def test_score_laundry_fixture_exact() -> None:
    expected = {
        "bill_kind": "laundry",
        "vendor_name": "shree dhobi ghat",
        "bill_no": "#4417",
        "bill_date": "2026-11-03",
        "piece_count": 12,
        "total": 240.5,
        "_hints": {"ignored": True},
    }
    s = score(Extraction.model_validate(LAUNDRY), expected)
    assert s == {
        "bill_kind": True,
        "vendor_name": True,
        "bill_no": True,
        "bill_date": True,
        "piece_count": True,
        "total": True,
    }


def test_match_rules() -> None:
    assert match("total", 1299, 1299.4)
    assert not match("total", 1299, 1301)
    assert match("vendor_name", "Zudio", "ZUDIO - Phoenix Mall Pune")
    assert not match("vendor_name", "Zudio", "Max Fashion")
    assert match("serial_no", "SN-12 34", "sn1234")
    assert not match("bill_date", "2026-04-03", "2026-03-04")
    assert match("warranty_months", None, None)
    assert not match("total", 100, None)


def test_summary_and_gate() -> None:
    rows = [{"total": True, "bill_kind": True}] * 9 + [{"total": False, "bill_kind": True}]
    s = summarise(rows)
    assert s["total"]["accuracy"] == 0.9
    g = gate(s)
    assert g["total"] and g["bill_kind"]
    assert not g["vendor_name"]  # not measured → fails the gate
