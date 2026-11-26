# Bill Box (codename)

Bill & warranty vault PWA: snap any bill (printed or handwritten), auto-extract details, get warranty / exchange / vendor-due reminders.

- Product scope, stack and conventions: [CLAUDE.md](CLAUDE.md)
- Phased build plan: [PLAN.md](PLAN.md)

## Hosting

| Part | Where | Notes |
|---|---|---|
| PWA (`web/`) | Vercel project `bill-box-web` | Static build, `web/vercel.json` |
| API (`api/`) | Vercel project `bill-box-api`, region **bom1 (Mumbai)** | FastAPI on Vercel Functions, entrypoint `app.main:app` |
| DB / Auth / Storage | Supabase `bill-box`, Mumbai | Migrations in `supabase/migrations/` |
| Batch poll (every 5 min) | Supabase pg_cron + pg_net | Vercel Hobby cron is daily-only |

> Vercel Hobby is for non-commercial use. Move to Pro before charging users (Phase 5).

## Quick start (Phase 2)

| Step | Command / action |
|---|---|
| 1. Supabase | Create project + run migration: see [supabase/README.md](supabase/README.md) |
| 2. API | `cd api && make install && cp .env.example .env` → fill `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` → `make dev` |
| 3. PWA | `cd web && npm install && cp .env.example .env` → fill `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` → `npm run dev` |
| 4. Phone test | `npm run build && npx vite preview --host`, open on your phone over the same Wi-Fi (camera + install need HTTPS or localhost; use an HTTPS tunnel such as `cloudflared tunnel --url http://localhost:4173`) |

### How a bill flows

```
+ button → camera/gallery/PDF/WhatsApp share
  → blur check → QR/barcode read → resize 1200px JPEG (on phone)
  → IndexedDB queue (survives offline)
  → bills row (status=uploading) → pages to private storage → status=processing
  → API POST /bills/{id}/extract  (or /bills/batch for > 3 gallery images)
  → Haiku 5.5 → bill row status=done + items
```

### Web scripts

| Command | What |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm test` | Unit tests (blur, QR parsers, offline queue) |
| `npm run typecheck` | TypeScript strict |
| `npm run build` | Production build + service worker |

## API (Phase 1 — extraction engine)

```bash
cd api
python -m venv .venv && source .venv/bin/activate
make install
cp .env.example .env        # add ANTHROPIC_API_KEY
make test                   # unit tests (no API calls)
make dev                    # http://localhost:8000/docs
```

| Endpoint | Purpose |
|---|---|
| `POST /bills/{id}/extract` | PWA: read an uploaded bill (live). Supabase JWT required |
| `POST /bills/batch` | PWA: bulk import via Message Batches API (50% cheaper) |
| `POST /bills/jobs/poll-batches` | Cron (every 5 min, `X-Cron-Secret`): save finished batch results |
| `POST /extract`, `/batch` | Dev: upload files directly (signed-in user) |
| `POST /jobs/poll-batches` | Cron for the dev `/batch` path |

Quick test:

```bash
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -F "files=@bill.jpg;type=image/jpeg" http://localhost:8000/extract
```

### Accuracy test (go/no-go gate)

Put real bill photos + `*.expected.json` in `api/tests/fixtures/bills/` (see its README; photos are gitignored), then:

```bash
make eval         # live
make eval-batch   # batch, 50% cheaper
```

Gate: `total`, `bill_date`, `vendor_name` ≥ 90% and `bill_kind` ≥ 95%.

> Not production-ready yet: quotas and rate limits land in Phases 5 and 6.
