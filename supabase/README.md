# Supabase setup

## 1. Create the project

1. Create a project at supabase.com (region: **Mumbai, ap-south-1**).
2. Run the migration: **SQL Editor** → paste `migrations/20261126000001_init.sql` → Run.
   Or with the CLI: `supabase link --project-ref <ref> && supabase db push`.
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
| **Service role / secret key** | `api/.env` `SUPABASE_SERVICE_ROLE_KEY` **only** | Bypasses RLS. Never in the PWA, never in git |
| JWT secret (legacy projects only) | `api/.env` `SUPABASE_JWT_SECRET` | New projects use asymmetric signing keys → leave empty, the API reads JWKS |

## Storage

The migration creates a **private** bucket `bills` (5 MB/file, JPEG/PNG/WebP/PDF). Object path: `<household_id>/<bill_id>/<page>.jpg`. Storage policies allow access only to members of that household.
