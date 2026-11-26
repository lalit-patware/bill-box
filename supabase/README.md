# Supabase setup

## 1. Create the project

1. Create a project at supabase.com (region: **Mumbai, ap-south-1**).
2. Run every file in `migrations/` **in order** (SQL Editor → paste → Run), or with the CLI:
   `supabase link --project-ref <ref> && supabase db push`.
   - `…01_init.sql`: tables, RLS, signup trigger, private `bills` bucket
   - `…02_hardening.sql`: advisor fixes (helper functions moved to a non-exposed `private` schema, `pg_trgm` → `extensions`, `(select auth.uid())` in policies, FK indexes)
   - `…03_batch_poll_cron.sql`: pg_cron job every 5 min → API `/bills/jobs/poll-batches` (needs Vault secrets `api_url`, `cron_secret`)
3. Check RLS isolation (local CLI stack or a scratch project):
   `psql "$DB_URL" -f tests/rls_test.sql` → should print `RLS isolation OK`.

## 2. Auth

| Setting | Value |
|---|---|
| Authentication → Providers → **Email** | Enabled (magic link). Turn **off** "Confirm email" double opt-in only if you want faster testing |
| Authentication → Providers → **Google** | Enabled. Create an OAuth client in Google Cloud Console; redirect URI = `https://<ref>.supabase.co/auth/v1/callback` |
| Authentication → URL Configuration → **Site URL** | `http://localhost:5173` (dev), later your Vercel domain |
| Redirect URLs | `http://localhost:5173/**`, `https://<your-domain>/**` |
| Phone / SMS | Leave **off** (cost + DLT) |

## 3. Keys

| Key | Goes to | Notes |
|---|---|---|
| Project URL | `web/.env` `VITE_SUPABASE_URL`, `api/.env` `SUPABASE_URL` | |
| Publishable / anon key | `web/.env` `VITE_SUPABASE_ANON_KEY` | Safe in the browser; RLS protects data |
| **Secret key** (`sb_secret_…`, tab *Publishable and secret API keys*) | `SUPABASE_SERVICE_ROLE_KEY` on the API only | Bypasses RLS. Never in the PWA, never in git. Legacy `service_role` JWTs also work but stop at the end of 2026 |
| JWT secret (legacy projects only) | `api/.env` `SUPABASE_JWT_SECRET` | New projects use asymmetric signing keys → leave empty, the API reads JWKS |

## Storage

The migration creates a **private** bucket `bills` (5 MB/file, JPEG/PNG/WebP/PDF). Object path: `<household_id>/<bill_id>/<page>.jpg`. Storage policies allow access only to members of that household.

## Current project

| Item | Value |
|---|---|
| Project | `bill-box`, ref `smwwswtjetnlmdbsnsoh`, region ap-south-1 (Mumbai) |
| Migrations applied | `init`, `hardening` (26 Nov 2026) |
| RLS isolation test | Passed |
| Security advisor | Clean except `public.rls_auto_enable()`, which Supabase creates for the "Enable RLS on new tables automatically" setting (not ours) |
