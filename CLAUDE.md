# PakkaBill — Bill & Warranty Vault (PWA)

> Turns kaccha (handwritten/informal) and pakka (printed/GST) bills into searchable records with warranty, exchange and payment reminders.
> Target: Indian households (Android-first) and small vendors' customers.

## Product scope (MVP)

| # | Feature | Notes |
|---|---|---|
| 1 | Capture bill | Camera, gallery, PDF, **Web Share Target** (share from WhatsApp) |
| 2 | Extract fields | Printed + **handwritten** (Hindi / English / Hinglish) via LLM vision |
| 3 | Scan codes | Product barcode (EAN/UPC), serial-number barcode, **GST e-invoice QR**, **UPI QR** (vendor identity) |
| 4 | Result card | No manual entry. Auto-saved result with one-tap confirm; "Fix" chip only on low-confidence fields |
| 5 | Total check | Recompute line items × qty; flag arithmetic mismatches |
| 6 | Bill types | `warranty`, `exchange_window`, `recurring_vendor` (milk, dhobi, newspaper), `general` |
| 7 | Vendor ledger | Monthly due / paid per vendor (milkman etc.), payment marked via UPI link or manual |
| 8 | Reminders | Web Push (30/7/1 days) + email fallback; WhatsApp later |
| 9 | Claim helper | Find bill → brand service number → draft complaint text |
| 10 | Family vault | Share one vault with family members (roles: owner, member) |
| 11 | Offline | View cached bills offline (IndexedDB), queue uploads when offline |

Out of scope for MVP: Gmail auto-import (restricted scope audit), WhatsApp bot, multi-currency.

## Core UX principle — "one tap in, zero typing"

- Single **+ Add** button → camera opens directly. Also: gallery (multi-select), PDF, share from WhatsApp/Gmail, screenshot.
- User never picks a category, vendor or date. AI classifies `bill_kind` and sets reminders automatically.
- Auto-save. Notify only when unsure ("Couldn't read the total — tap to fix").
- Client-side blur check before upload → "Too blurry, retake?" (saves a wasted scan).
- Auto-crop edges, multi-page support (long receipts / 2-page PDFs), duplicate detection (image hash + vendor/date/total).
- First-run: "Import old bills from gallery" → bulk upload, processed via Batch API (50% cheaper).

## Real-world scenarios (AI must classify into `bill_kind`)

| bill_kind | Example | Typical input | Extract | Auto actions |
|---|---|---|---|---|
| `retail_fashion` | Max, Zudio, Zara, Westside, Trends | Thermal receipt photo, SMS/email e-bill | Store, branch, date, bill no, items (decode short codes like "TSHRT M BLK"), size, price, exchange/return policy text | Exchange-window reminder (from bill text; else store default table); keep high-contrast copy since thermal paper fades |
| `electronics` | Croma, Reliance Digital, local mobile shop, Amazon invoice | PDF or photo + box barcode | Product, brand, model, serial/IMEI, warranty months, extended warranty | Warranty reminders 30/7/1 days; claim helper |
| `recurring_milk` | Milkman monthly card/diary, WhatsApp message "Nov 58L × 64 = 3712" | Photo of card, screenshot | Month, daily litres grid, rate, total, absent days | Recompute total, add to vendor ledger, "Due ₹X" card, rate-change history |
| `laundry` | Dhobi/istri slip, dry-cleaner token | Photo when handing over clothes | Slip/token no, piece count (by type if written), amount, promised date | "Pickup due" reminder; on return → "Received all 12?" one tap; monthly total |
| `textile_kaccha` | Saree/fabric/cloth shop handwritten bill | Photo | Shop, items, meters, rate, total, notes ("tailor: Ramesh") | No warranty; searchable for future reference (repeat purchase, tailor, disputes) |
| `vendor_credit` | Kirana udhaar slip, local vendor | Photo | Vendor, items, amount, paid/credit | Add to vendor ledger, monthly due summary |
| `medical_consult` | Doctor/clinic fee receipt, pharmacy bill | Photo | Doctor/clinic name, patient name, date, fee, pharmacy items + amounts | Group under "Medical" for claims/tax; **never interpret prescriptions** (no medicine/dose extraction, no advice); keep the image |
| `hospital` | Hospital final bill, discharge bill, lab reports (multi-page PDF) | PDF / multiple photos | Hospital, patient, admission–discharge dates, bill no, total, paid, insurer/TPA, claim no | Group pages into one "Hospital visit"; "Claim pack" export (all bills as one PDF) |
| `general` | Anything else | Any | Vendor, date, total | Store only |

Medical data is personal health data: private bucket only, no analytics on content, explicit user consent screen on first medical bill, easy delete (India DPDP Act).

Vendor matching: link a new bill to an existing vendor by phone → UPI VPA → name similarity. First bill auto-creates vendor (e.g. "Dudhwala – Ramesh"); user may rename once, optional.

## Home screen (only 3 blocks)

1. **Action needed** — "Zudio exchange ends in 2 days", "Milk due ₹3,712", "12 clothes at dhobi since Mon".
2. **Search** — natural language: "blue shirt zudio", "milk October", "fridge warranty".
3. **Recent bills** — thumbnails.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + TypeScript, `vite-plugin-pwa` (Workbox, injectManifest) |
| UI | Tailwind CSS + shadcn/ui, mobile-first, Hindi + English (i18next) |
| Local storage | IndexedDB via Dexie (offline cache + upload queue) |
| Barcode/QR | Native `BarcodeDetector` when available, fallback `zxing-wasm` (iOS Safari) |
| Backend | FastAPI (Python 3.12), Pydantic v2 |
| DB / Auth / Files | Supabase: Postgres + Google sign-in / email magic link (no SMS OTP) + private storage bucket (signed URLs) |
| AI extraction | **Claude Haiku 5.5 only** (`claude-haiku-5-5`): live Messages API for single scans + Message Batches API (50% off) for bulk/non-urgent. No Sonnet. |
| Jobs | Supabase cron or Celery for reminder scheduling |
| Push | Web Push (VAPID) via `pywebpush` |
| Payments | Razorpay subscriptions |
| Hosting | Vercel (frontend), Render/Fly/Railway (FastAPI) |

## Extraction pipeline

1. **Client pre-process** (canvas): auto-rotate (EXIF), resize to max 1600px long edge, JPEG ~0.8, light contrast boost.
2. **Client code scan** (parallel): run BarcodeDetector on the image; decode any QR:
   - GST e-invoice QR → JWT payload (base64 decode, no signature verify) → GSTIN, invoice no, date, total.
   - UPI QR (`upi://pay?pa=...&pn=...`) → vendor VPA + name → link/create vendor.
   - EAN/UPC → store as `product_barcode`; serial barcodes → `serial_no`.
3. **Server LLM call** (Haiku 5.5, live or batch — see cost routing) with image + any decoded code data as hints. Strict JSON schema (Pydantic):
   - `bill_kind, vendor_name, vendor_phone, bill_date, bill_no, items[{name, qty, unit, rate, amount}], subtotal, tax, total, language, is_handwritten, warranty_months, exchange_days, notes`
   - Every field returns `{value, confidence}`.
   - Prompt must handle: Hinglish abbreviations ("1 kg - 60", "dudh 2L"), missing dates, carbon copies, crossed-out lines, monthly milk tallies (date grid of litres).
4. **Validation**: recompute `sum(items.amount)` and `qty × rate`; set `total_mismatch` flag if off by > ₹1.
5. **Auto-save**: no manual entry form anywhere in the app (users may correct a single field on the bill screen). Bill saves automatically after extraction; a card shows the result with a single "Looks right ✓" tap. Only fields with confidence < 0.7 or `total_mismatch` show a "Fix" chip (tap → Haiku re-reads a higher-resolution crop of that area, or user edits that one field).

**Cost routing (every bill is photo/scan only, Haiku 5.5 only):**

| Trigger | Path | ≈ Cost |
|---|---|---|
| GST e-invoice QR decoded on device | Use QR data, skip LLM | ₹0 |
| Single photo / PDF / share (user waiting) | Haiku 5.5 live (Messages API) | ~₹0.06 |
| Gallery bulk import (> 3 images) or "Import old bills" | Haiku 5.5 **Message Batches API** → status "Processing…" → push notification when done | ~₹0.03 |
| "Fix" tap | Haiku 5.5 live on cropped high-res region | ~₹0.03 |

- Image resized to ~1200px long edge; system prompt + JSON schema cached (prompt caching).
- Batch worker: submit batch job, poll every 5 min via cron/Celery, write results, send push. Batches can take up to 24h; UI must show pending bills as "Processing" cards.
- Same prompt + Pydantic schema for live and batch paths (one `extract_request()` builder).
- Track per-household scan count for plan limits; log tokens from `usage` per request.

## Data model (Postgres)

| Table | Key columns |
|---|---|
| `households` | id, name, owner_id, plan, scan_credits |
| `members` | household_id, user_id, role |
| `vendors` | id, household_id, name, phone, upi_vpa, category (milk, textile, electronics…), is_recurring |
| `bills` | id, household_id, created_by, vendor_id, status (uploading/processing/done/failed), source, page_paths (text[]), hints (jsonb, on-device QR data), bill_kind, vendor_name, bill_date, bill_no, total, tax, is_handwritten, total_mismatch, needs_fix, ai_pending, raw_extraction (jsonb), validation (jsonb), prompt_version, cost_inr, batch_id, image_hash (dHash), duplicate_of, confirmed_at, error |
| `bill_items` | id, bill_id, name, qty, unit, rate, amount |
| `products` | id, bill_id, name, brand, model, serial_no, product_barcode, warranty_until, exchange_until |
| `vendor_ledger` | id, vendor_id, month, amount_due, amount_paid, paid_on |
| `reminders` | id, household_id, ref_type, ref_id, remind_at, channel, sent_at |
| `push_subscriptions` | user_id, endpoint, keys (jsonb) |

Row Level Security: every table scoped by `household_id` through `members` (`private.is_member()`).

Database functions: `public.link_bill_vendor(bill)` (service role only: vendor match by phone → UPI VPA → name similarity, sets `duplicate_of`), `public.search_bills(words, kinds, month, year)` (security invoker, RLS applies). Scheduled job `poll-bill-batches` (pg_cron, every 5 min) calls the API to collect batches and re-read `ai_pending` bills.

Phase 4: `public.after_bill_saved(bill)` (service role) runs after every save → vendor link, shop exchange default (`vendors.exchange_days`), `vendor_ledger` monthly sum, `reminders` (exchange 2/0 days, warranty 30/7/1, laundry pickup, vendor due; stale ones get `dismissed_at`). Hourly pg_cron `send-reminders` → API `/bills/jobs/send-reminders` → Web Push (VAPID) → email fallback (Resend, optional) → in-app "Action needed". `user_consents` holds the medical consent. Web: `/vendors` dues page (UPI deep link + mark paid), laundry "Received all N", claim text + claim-pack PDF (pdf-lib).

Migrations are applied to the live project via the Supabase connector and kept in `supabase/migrations/` (one file per change).

## Repo layout

```
/web        React PWA (Vite)
  src/features/capture   camera, share-target, preprocess, barcode
  src/features/review    extraction review UI
  src/features/vault     bills list, search, filters
  src/features/vendors   ledger, monthly dues
  src/sw.ts              service worker (share target, push, offline)
/api        FastAPI
  app/routers  bills, vendors, reminders, extraction
  app/llm      prompts, schemas, model routing
  app/jobs     reminder scheduler
/supabase   migrations, RLS policies, seed
```

## Conventions

- TypeScript strict; no `any`. Python: type hints + Pydantic everywhere.
- All LLM prompts live in `api/app/llm/prompts/` as versioned files; log prompt version with each extraction.
- Never send bill images to logs/analytics. Storage bucket is private; use signed URLs (≤ 10 min).
- Mobile-first: test at 360px width; tap targets ≥ 44px.
- Every extraction stored in `raw_extraction` for re-processing when prompts improve.
- Keep a `/api/tests/fixtures/bills/` set of sample images (printed, handwritten Hindi, milk tally, textile kaccha bill, GST e-invoice) and a regression test that checks extraction accuracy.

## Build milestones

See **PLAN.md** for the phased execution plan (Phase 0 go/no-go → Phase 6 launch), done-criteria and per-phase prompts.
