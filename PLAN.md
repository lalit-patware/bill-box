# PakkaBill — End-to-End Build Plan

> Companion to `CLAUDE.md` (product scope, stack, conventions). This file = execution order.
> Estimate: **~6 weeks part-time** (≈ 2–3 hrs/day weekdays + weekends). Build backend extraction first — it is the riskiest part.

---

## Architecture

```
 ┌─────────────── PWA (React 19 + Vite, Vercel) ───────────────┐
 │ capture · preprocess · blur check · QR/barcode · Dexie cache │
 │ service worker: share target · push · offline queue          │
 └───────────────┬──────────────────────────────────────────────┘
                 │ HTTPS (Supabase JWT)
 ┌───────────────▼────────────── FastAPI (Render/Fly) ──────────┐
 │ /extract (live)  /batch (bulk)  /bills  /vendors  /reminders │
 │ /jobs/* (cron: batch poll, reminders)   Langfuse tracing     │
 └──────┬──────────────────────────┬────────────────────────────┘
        │                          │
 ┌──────▼───────────┐     ┌────────▼──────────────────────────┐
 │ Supabase         │     │ Anthropic API — Claude Haiku 5.5  │
 │ Postgres + RLS   │     │ Messages (live) + Batches (bulk)  │
 │ Auth · Storage   │     └───────────────────────────────────┘
 └──────────────────┘
 Cron: Render Cron Job → POST /jobs/poll-batches (5 min), /jobs/send-reminders (hourly)
 Push: Web Push (VAPID) · Email: Resend · Payments: Razorpay
```

---

## Phase 0 — Prep & go/no-go (3 days)

| # | Task | Done when |
|---|---|---|
| 0.1 | Collect **40 real bills**: 5 retail fashion (Zudio/Max/Westside), 5 electronics, 5 milk cards, 5 dhobi slips, 5 textile kaccha, 5 kirana/vendor, 5 doctor/pharmacy, 3 hospital, 2 GST e-invoice | Photos in `api/tests/fixtures/bills/<kind>/` |
| 0.2 | Write expected JSON for each bill (vendor, date, total, items, bill_kind) | `*.expected.json` next to each image |
| 0.3 | Accounts: Anthropic Console ($5 + spend limit), Supabase, Vercel, Render, Razorpay, Resend, domain | Keys in a password manager, not git |
| 0.4 | Prototype extraction prompt in a script/notebook against the 40 bills | Accuracy report printed |
| 0.5 | **Go/no-go gate** | ≥ 90% correct on `total` + `bill_date` + `vendor_name`, ≥ 95% on `bill_kind`. If not met → improve prompt/preprocessing before building UI |

## Phase 1 — Extraction engine (Week 1)

| # | Task | Done when |
|---|---|---|
| 1.1 | Scaffold `/api` (FastAPI, Python 3.12, uv/poetry, ruff, pytest) | `GET /health` ok |
| 1.2 | Pydantic `Extraction` schema: per-field `{value, confidence}`, `bill_kind` enum, items, totals | Schema exported as JSON schema |
| 1.3 | Versioned prompt `prompts/extract_v1.md`; single `extract_request()` builder (shared by live + batch); prompt caching on system prompt + schema | Unit test builds identical payloads for both paths |
| 1.4 | `POST /extract` (live Haiku 5.5) + total-mismatch validator | Returns validated JSON for a fixture |
| 1.5 | `POST /batch` + `jobs/poll-batches` (Message Batches API) | 10 fixtures processed via batch end-to-end |
| 1.6 | **Eval harness** `make eval`: runs all fixtures, prints per-field accuracy + cost (from `usage`) | Runs in CI on prompt changes |
| 1.7 | Langfuse tracing (prompt version, tokens, latency, cost) | Traces visible |

## Phase 2 — PWA shell + capture (Week 2)

| # | Task | Done when |
|---|---|---|
| 2.1 | Scaffold `/web` (React 19, Vite, TS strict, Tailwind, shadcn, `vite-plugin-pwa` injectManifest, i18next en/hi) | Installable PWA, Lighthouse PWA pass |
| 2.2 | Supabase migrations: all tables + RLS by `household_id`; auto-create household on signup | RLS tests pass (user A can't read user B) |
| 2.3 | Auth: **Google sign-in + email magic link** (no SMS OTP — cost + DLT hassle) | Login works on Android Chrome + iOS Safari |
| 2.4 | **+ Add** button → camera directly (`capture="environment"`); gallery multi-select; PDF picker | All 3 inputs produce files |
| 2.5 | Client preprocess: EXIF rotate, resize 1200px, JPEG 0.8, blur check (Laplacian variance) → "Retake?" | Blurry fixture rejected, clear one passes |
| 2.6 | QR/barcode: `BarcodeDetector` + `zxing-wasm` fallback; parse GST e-invoice QR, UPI QR, EAN/serial | GST QR bill saved with ₹0 LLM call |
| 2.7 | Upload to private Supabase bucket → call `/extract` (1–3 files) or `/batch` (> 3) | Bill row created with status `processing` → `done` |
| 2.8 | **Web Share Target** in manifest + SW handler (images, PDF, text) | Share from WhatsApp → bill saved |
| 2.9 | Offline queue (Dexie): captures while offline upload when back online | Airplane-mode test passes |

## Phase 3 — Vault & result UX (Week 3) ✅ shipped

| # | Task | Done when |
|---|---|---|
| 3.1 | Result card: auto-saved, "Looks right ✓", **Fix** chip on low-confidence fields (Haiku re-read of crop, or edit one field) | No full form anywhere |
| 3.2 | Vendor auto-linking: phone → UPI VPA → name similarity (pg_trgm) | 2nd milk card links to same vendor |
| 3.3 | Duplicate detection: perceptual image hash + (vendor, date, total) | Same bill twice → "Already saved" |
| 3.4 | Multi-page bills: group photos/PDF pages into one bill | Hospital 3-page bill = 1 record |
| 3.5 | Home screen: **Action needed / Search / Recent** | Matches CLAUDE.md layout |
| 3.6 | Search: Postgres FTS + pg_trgm over vendor, items, notes; month/kind keywords ("milk october") | 10 sample queries return correct bills |
| 3.7 | Bill detail: zoomable original image, extracted fields, delete | Works offline from cache |

## Phase 4 — Smart actions (Week 4) ✅ shipped

| # | Task | Done when |
|---|---|---|
| 4.1 | Reminder rules per `bill_kind` (warranty 30/7/1d, exchange window, laundry pickup, monthly vendor due) | Rows auto-created on save |
| 4.2 | Web Push (VAPID) + email fallback (Resend); `jobs/send-reminders` hourly | Push received on Android; email on iOS non-installed |
| 4.3 | Vendor ledger: monthly due/paid, "Mark paid", UPI pay link (`upi://pay?pa=…&am=…`) | Milk due card → paid in 1 tap |
| 4.4 | Laundry flow: "Received all 12?" on pickup reminder | Pending clears in 1 tap |
| 4.5 | Total-check UI: "Bill total ₹3,712 but items add to ₹3,648" | Mismatch fixture flagged |
| 4.6 | Retail exchange: policy from bill text; fallback store-default table (user-editable) | Zudio fixture gets exchange reminder |
| 4.7 | Claim helper + **Claim pack** PDF (all pages of a hospital visit / warranty bill) | PDF downloads correctly |
| 4.8 | Medical: consent screen on first medical bill; never extract medicines/doses | Consent stored, prompt verified |

## Phase 5 — Monetization & family (Week 5)

| # | Task | Done when |
|---|---|---|
| 5.1 | Scan quota per household (free 5/month); check before any LLM call | 6th scan → upgrade sheet |
| 5.2 | Razorpay: ₹10 pack (25 scans, no expiry), ₹99/yr family (300 scans) + webhook → credits | Test-mode payments credit scans |
| 5.3 | Family: invite link, roles owner/member, shared vault | Spouse sees same bills |
| 5.4 | First-run "Import old bills from gallery" → batch path | 30 photos imported overnight |

## Phase 6 — Hardening & launch (Week 6)

> Before launch: publish the Google OAuth app (Google Auth Platform → Branding: add homepage `https://<domain>/`, privacy `/privacy`, terms `/terms`; then Audience → Publish). Until then only listed test users can use Google sign-in.

| # | Task | Done when |
|---|---|---|
| 6.1 | Security: rate limit `/extract` (20/hr/user), 5 MB upload cap, signed URLs ≤ 10 min, CORS lock | Abuse test blocked |
| 6.2 | Cost guard: Console spend limit + daily cost alert from Langfuse | Alert fires in test |
| 6.3 | DPDP basics: privacy policy, consent, export my data, delete account (hard delete images) | Delete removes storage objects |
| 6.4 | Observability: Sentry (web + api), uptime check | Errors visible |
| 6.5 | Device testing: low-end Android (2–3 GB RAM), iPhone Safari, slow 3G | Capture → result < 8 s on 4G |
| 6.6 | Hindi UI pass | All screens translated |
| 6.7 | Landing page + ₹1 pre-order / waitlist | Live on domain |
| 6.8 | **Closed beta: 20 families (Indore + Pune)**, feedback form | 2 weeks of real usage, top 5 issues fixed |
| 6.9 | Public launch: WhatsApp groups, r/india, r/developersIndia, Product Hunt, LinkedIn | — |

---

## Later: phone login (decided 26 Nov 2026: free for now)

Login stays Google + email magic link (₹0). When users ask for phone login, add it via the Supabase **Send SMS hook** → our API → **MSG91 WhatsApp OTP** (~₹0.10/OTP; needs an MSG91 account + WhatsApp Business number). Fallback: MSG91 SMS (~₹0.15/OTP + DLT registration).

## Metrics to track from day 1

| Metric | Target |
|---|---|
| Extraction accuracy (total/date/vendor) | ≥ 90% |
| Bills needing "Fix" | < 15% |
| Capture → saved time | < 8 s |
| Cost per bill (blended) | ≤ ₹0.06 |
| Week-4 retention | ≥ 30% |
| Free → paid conversion | ≥ 3% |

## Risks

| Risk | Mitigation |
|---|---|
| Handwriting accuracy below gate | Better preprocessing, prompt few-shot examples per kind, "Fix" crop re-read |
| iOS push limits | Email fallback; prompt "Add to Home Screen" |
| Users won't pay | Validate with ₹1 pre-order before Phase 5; dealer B2B variant as backup |
| API cost spike / abuse | Quotas before LLM call, rate limits, spend limit |
| Health-data trust | Consent, private storage, easy delete, clear privacy page |

---

## Claude Code prompts (paste one per phase)

**Phase 0/1**
```
Read CLAUDE.md and PLAN.md. Execute Phase 1 (tasks 1.1–1.7).
Start with 1.6 eval harness skeleton so every prompt change is measured against
api/tests/fixtures/bills. Use claude-haiku-5-5 only. Stop after each task,
show the diff, run tests and `make eval`.
```

**Phase 2**
```
Read CLAUDE.md and PLAN.md. Execute Phase 2 (2.1–2.9). Mobile-first at 360px.
Auth = Google + email magic link (no SMS). Stop after each task, show diff, run tests.
```

**Phase 3**
```
Read CLAUDE.md and PLAN.md. Execute Phase 3 (3.1–3.7). No manual-entry forms anywhere;
only result card + Fix chip. Stop after each task, show diff, run tests.
```

**Phase 4**
```
Read CLAUDE.md and PLAN.md. Execute Phase 4 (4.1–4.8). Reminder rules keyed by bill_kind.
Never extract medicine names or doses. Stop after each task, show diff, run tests.
```

**Phase 5–6**
```
Read CLAUDE.md and PLAN.md. Execute Phase 5 then Phase 6. Razorpay in test mode first.
Quota check must run before every LLM call. Stop after each task, show diff, run tests.
```
