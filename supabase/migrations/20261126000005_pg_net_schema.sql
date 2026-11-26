-- Advisor fix: pg_net was created in `public` by migration 03. Recreate it in `extensions`.
-- Its functions live in the `net` schema either way, so the cron job keeps working.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
