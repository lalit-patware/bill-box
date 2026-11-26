-- Non-AI fallback: bills saved without the model are marked ai_pending and
-- re-read automatically by the 5-minute job once AI is available again.

alter table public.bills add column if not exists ai_pending boolean not null default false;
create index if not exists bills_ai_pending_idx on public.bills (created_at) where ai_pending;

-- Re-schedule the job (same name → replaces it) so it also runs when bills await an AI re-read.
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
    select 1 from public.bills
    where (status = 'processing' and batch_id is not null) or ai_pending
  );
  $$
);
