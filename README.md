# Bill Box (codename)

Bill & warranty vault PWA: snap any bill (printed or handwritten), auto-extract details, get warranty / exchange / vendor-due reminders.

- Product scope, stack and conventions: [CLAUDE.md](CLAUDE.md)
- Phased build plan: [PLAN.md](PLAN.md)

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
| `POST /extract` | 1–3 pages of one bill → extraction + validation + cost (live, Haiku 5.5) |
| `POST /batch` | Many bills (one file each) → Message Batches API, 50% cheaper |
| `GET /batch/{id}` | Batch status / results |
| `POST /jobs/poll-batches` | Cron hook: collect finished batches |

Quick test:

```bash
curl -F "files=@bill.jpg;type=image/jpeg" http://localhost:8000/extract
```

### Accuracy test (go/no-go gate)

Put real bill photos + `*.expected.json` in `api/tests/fixtures/bills/` (see its README; photos are gitignored), then:

```bash
make eval         # live
make eval-batch   # batch, 50% cheaper
```

Gate: `total`, `bill_date`, `vendor_name` ≥ 90% and `bill_kind` ≥ 95%.

> Local development only for now: auth, quotas and rate limits land in Phases 2, 5 and 6.
