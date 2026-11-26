-- Every 5 minutes, ask the API to collect finished Message Batches results.
-- Vercel Hobby cron only runs daily, so Supabase (pg_cron + pg_net) does the scheduling.
-- Only calls the API when some bill is actually waiting on a batch.
--
-- Needs two Vault secrets (created outside migrations, never committed):
--   select vault.create_secret('https://<api-domain>', 'api_url');
--   select vault.create_secret('<same value as CRON_SECRET on the API>', 'cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'poll-bill-batches',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'api_url')
           || '/bills/jobs/poll-batches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (
    select 1 from public.bills where status = 'processing' and batch_id is not null
  );
  $$
);
