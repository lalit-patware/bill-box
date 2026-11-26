"""Run every bill fixture against Claude Haiku 5.5 and print accuracy + cost.

Fixture layout (images are gitignored; only *.expected.json is committed):

    tests/fixtures/bills/<bill_kind>/<name>.jpg            single page
    tests/fixtures/bills/<bill_kind>/<name>/1.jpg, 2.jpg   multi-page (sorted)
    tests/fixtures/bills/<bill_kind>/<name>.expected.json  fields to check

Usage:
    python -m eval.run_eval              # live Messages API
    python -m eval.run_eval --batch      # Message Batches API (50% off, slower)
    python -m eval.run_eval --only laundry
"""

import argparse
import json
import mimetypes
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from app.llm.extractor import batch_status, collect_batch, extract_live, get_client, submit_batch
from app.llm.request_builder import PDF_TYPE, SUPPORTED_IMAGE_TYPES, BillFile
from app.llm.schemas import ExtractResult
from eval.scoring import GATES, SCORABLE, gate, score, summarise

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "bills"
REPORTS = Path(__file__).resolve().parent / "reports"
MEDIA_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"}


@dataclass
class Case:
    case_id: str
    pages: list[Path]
    expected: dict[str, Any]


def _media_type(p: Path) -> str:
    mt = mimetypes.guess_type(p.name)[0] or ""
    if mt not in SUPPORTED_IMAGE_TYPES | {PDF_TYPE}:
        raise ValueError(f"Unsupported fixture type: {p}")
    return mt


def discover(only: str | None = None) -> tuple[list[Case], list[str]]:
    cases: list[Case] = []
    missing: list[str] = []
    for exp in sorted(FIXTURES.rglob("*.expected.json")):
        stem = exp.name.removesuffix(".expected.json")
        case_id = str(exp.relative_to(FIXTURES)).removesuffix(".expected.json")
        if only and only not in case_id:
            continue
        folder = exp.parent / stem
        if folder.is_dir():
            pages = sorted(p for p in folder.iterdir() if p.suffix.lower() in MEDIA_EXT)
        else:
            pages = [p for p in exp.parent.glob(f"{stem}.*") if p.suffix.lower() in MEDIA_EXT]
        if not pages:
            missing.append(case_id)
            continue
        cases.append(Case(case_id, pages, json.loads(exp.read_text(encoding="utf-8"))))
    return cases, missing


def _files(case: Case) -> list[BillFile]:
    return [BillFile(p.read_bytes(), _media_type(p)) for p in case.pages]


def run_live(cases: list[Case]) -> dict[str, ExtractResult | str]:
    client = get_client()
    out: dict[str, ExtractResult | str] = {}
    for i, c in enumerate(cases, 1):
        print(f"[{i}/{len(cases)}] {c.case_id} ...", end=" ", flush=True)
        try:
            out[c.case_id] = extract_live(_files(c), c.expected.get("_hints"), client)
            print("ok")
        except Exception as exc:  # noqa: BLE001
            out[c.case_id] = f"error: {exc}"
            print("ERROR", exc)
    return out


def run_batch(cases: list[Case], poll_seconds: int = 30) -> dict[str, ExtractResult | str]:
    client = get_client()
    id_map = {f"case-{i}": c.case_id for i, c in enumerate(cases)}
    jobs = [
        (cid, _files(c), c.expected.get("_hints")) for cid, c in zip(id_map, cases, strict=True)
    ]
    batch_id = submit_batch(jobs, client)
    print(f"Submitted batch {batch_id} with {len(jobs)} bills. Polling every {poll_seconds}s…")
    while batch_status(batch_id, client) != "ended":
        time.sleep(poll_seconds)
        print(".", end="", flush=True)
    print()
    return {id_map[k]: v for k, v in collect_batch(batch_id, client).items()}


def report(cases: list[Case], results: dict[str, ExtractResult | str], mode: str) -> int:
    rows: list[dict[str, bool]] = []
    per_case: list[dict[str, Any]] = []
    cost = 0.0
    fix_needed = 0
    for c in cases:
        r = results.get(c.case_id, "missing result")
        if isinstance(r, str):
            per_case.append({"case": c.case_id, "error": r})
            rows.append({k: False for k in c.expected if k in SCORABLE})
            continue
        s = score(r.extraction, c.expected)
        rows.append(s)
        cost += r.usage.cost_inr
        if r.validation.low_confidence_fields or r.validation.total_mismatch:
            fix_needed += 1
        per_case.append(
            {
                "case": c.case_id,
                "wrong": [k for k, ok in s.items() if not ok],
                "low_confidence": r.validation.low_confidence_fields,
                "total_mismatch": r.validation.total_mismatch,
                "cost_inr": r.usage.cost_inr,
                "tokens_in": r.usage.input_tokens + r.usage.cache_read_input_tokens,
                "tokens_out": r.usage.output_tokens,
                "extraction": r.extraction.model_dump(mode="json"),
            }
        )

    summary = summarise(rows)
    gates = gate(summary)

    print("\nField accuracy")
    print(f"{'field':<18}{'n':>4}{'accuracy':>10}{'gate':>8}")
    for name, s in summary.items():
        g = GATES.get(name)
        mark = "" if g is None else ("PASS" if gates[name] else "FAIL")
        print(f"{name:<18}{s['n']:>4}{s['accuracy']:>10.1%}{mark:>8}")

    print("\nWrong fields per bill")
    for pc in per_case:
        if pc.get("error"):
            print(f"  {pc['case']}: {pc['error']}")
        elif pc["wrong"]:
            print(f"  {pc['case']}: {', '.join(pc['wrong'])}")

    n = len(cases)
    print(f"\nBills: {n} | needing Fix: {fix_needed} ({fix_needed / n:.0%})")
    print(f"Cost ({mode}): ₹{cost:.2f} total, ₹{cost / n:.3f} per bill")
    passed = all(gates.values())
    print(f"\nGo/no-go gate: {'PASS ✅' if passed else 'FAIL ❌'}")

    REPORTS.mkdir(exist_ok=True)
    path = REPORTS / f"{datetime.now():%Y%m%d-%H%M%S}-{mode}.json"
    path.write_text(
        json.dumps(
            {"mode": mode, "summary": summary, "gates": gates, "cases": per_case},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Report: {path.relative_to(ROOT)}")
    return 0 if passed else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", action="store_true", help="use the Message Batches API")
    ap.add_argument("--only", help="substring filter on case id, e.g. 'laundry'")
    args = ap.parse_args()

    cases, missing = discover(args.only)
    if missing:
        print(f"Skipping {len(missing)} expected.json without images: {', '.join(missing)}")
    if not cases:
        print(f"No fixtures with images found under {FIXTURES}. See its README.md.")
        return 2

    results = run_batch(cases) if args.batch else run_live(cases)
    return report(cases, results, "batch" if args.batch else "live")


if __name__ == "__main__":
    sys.exit(main())
