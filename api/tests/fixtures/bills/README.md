# Bill fixtures (accuracy test set)

Real bill photos are **personal data**, so images are gitignored. Only `*.expected.json` files are committed. Keep the photos on your machine (or a private drive) and drop them in next to their JSON.

## Layout

```
bills/
  retail_fashion/zudio_01.jpg
  retail_fashion/zudio_01.expected.json
  hospital/city_hosp_01/1.jpg      ← multi-page: folder with pages (sorted by name)
  hospital/city_hosp_01/2.jpg
  hospital/city_hosp_01.expected.json
```

Folders match `bill_kind`: `retail_fashion`, `electronics`, `recurring_milk`, `laundry`, `textile_kaccha`, `vendor_credit`, `medical_consult`, `hospital`, `general`.

## Target set (Phase 0)

| Folder | Count |
|---|---|
| retail_fashion | 5 |
| electronics | 5 |
| recurring_milk | 5 |
| laundry | 5 |
| textile_kaccha | 5 |
| vendor_credit | 5 |
| medical_consult | 5 |
| hospital | 3 |
| general (GST e-invoice) | 2 |

## expected.json

Only include fields you can read yourself with certainty. Anything you include is scored; anything you leave out is ignored.

```json
{
  "bill_kind": "laundry",
  "vendor_name": "Shree Dhobi Ghat",
  "bill_no": "4417",
  "bill_date": "2026-11-03",
  "piece_count": 12,
  "total": 240,
  "is_handwritten": true
}
```

| Field | Compared as |
|---|---|
| `total`, `subtotal`, `tax`, `warranty_months`, `exchange_days`, `piece_count` | number, ±1 |
| `bill_kind`, `bill_date` (yyyy-mm-dd), `period_month` (yyyy-mm), `promised_date`, `is_handwritten` | exact |
| `vendor_name`, `patient_name` | fuzzy (contains, or ≥ 80% similar) |
| `bill_no`, `serial_no`, `vendor_phone` | letters/digits only, exact |
| `_hints` (optional) | passed to the model as decoded QR/barcode data, not scored |

## Run

```bash
cd api
cp .env.example .env   # add ANTHROPIC_API_KEY
make eval              # live
make eval-batch        # 50% cheaper
python -m eval.run_eval --only laundry
```

Go/no-go gate: total, bill_date, vendor_name ≥ 90% and bill_kind ≥ 95%.
