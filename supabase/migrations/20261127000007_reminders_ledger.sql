-- Phase 4: reminders, vendor ledger, laundry pickup, medical consent, vendor exchange defaults.

-- ───────────── columns ─────────────
alter table public.bills add column if not exists laundry_received_at timestamptz;
alter table public.vendors add column if not exists exchange_days int check (exchange_days between 0 and 365);
alter table public.vendor_ledger add column if not exists bill_id uuid references public.bills (id) on delete set null;
create index if not exists vendor_ledger_bill_idx on public.vendor_ledger (bill_id);

alter table public.reminders add column if not exists kind text;
alter table public.reminders add column if not exists title text;
alter table public.reminders add column if not exists body text;
alter table public.reminders add column if not exists url text;
alter table public.reminders add column if not exists dismissed_at timestamptz;
create index if not exists reminders_ref_idx on public.reminders (ref_type, ref_id);

-- Members may dismiss their reminders.
create policy reminders_update on public.reminders for update
  using (private.is_member(household_id)) with check (private.is_member(household_id));

-- ───────────── consent ─────────────
create table if not exists public.user_consents (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('medical')),
  granted_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.user_consents enable row level security;
create policy user_consents_own on public.user_consents for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────── helpers ─────────────
create or replace function private.iso_date(t text)
returns date language sql immutable as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}$' then t::date end;
$$;

-- 09:00 India time on a date, as timestamptz.
create or replace function private.ist(d date, hhmm time default '09:00')
returns timestamptz language sql immutable as $$
  select (d + hhmm) at time zone 'Asia/Kolkata';
$$;

-- ───────────── ledger ─────────────
-- Recurring vendors (milk, dhobi, kirana): one ledger row per vendor per month,
-- amount_due = sum of that month's bills (duplicates excluded).
create or replace function public.upsert_bill_ledger(p_bill uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bills%rowtype;
  v_month date;
begin
  select * into b from public.bills where id = p_bill;
  if not found or b.vendor_id is null or b.total is null or b.duplicate_of is not null then
    return;
  end if;
  if not exists (select 1 from public.vendors where id = b.vendor_id and is_recurring) then
    return;
  end if;

  v_month := date_trunc('month', coalesce(
    private.iso_date((b.raw_extraction -> 'period_month' ->> 'value') || '-01'),
    b.bill_date,
    b.created_at::date))::date;

  insert into public.vendor_ledger (vendor_id, month, amount_due, bill_id)
  select b.vendor_id, v_month, coalesce(sum(o.total), 0), b.id
    from public.bills o
   where o.vendor_id = b.vendor_id
     and o.status = 'done'
     and o.duplicate_of is null
     and date_trunc('month', coalesce(
           private.iso_date((o.raw_extraction -> 'period_month' ->> 'value') || '-01'),
           o.bill_date, o.created_at::date))::date = v_month
  on conflict (vendor_id, month) do update
    set amount_due = excluded.amount_due, bill_id = excluded.bill_id;
end;
$$;

-- ───────────── reminders ─────────────
-- Rebuilds the unsent reminders for one bill from its current data.
create or replace function public.schedule_bill_reminders(p_bill uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b       public.bills%rowtype;
  p       record;
  v_name  text;
  v_when  timestamptz;
  v_off   int;
  v_n     int := 0;
  v_pick  date;
begin
  -- Retire earlier unsent reminders for this bill (kept as history, never sent).
  update public.reminders set dismissed_at = now()
   where ref_type = 'bill' and ref_id = p_bill and sent_at is null and dismissed_at is null;

  select * into b from public.bills where id = p_bill;
  if not found or b.status <> 'done' or b.duplicate_of is not null then
    return 0;
  end if;
  v_name := coalesce(b.vendor_name, 'your bill');

  for p in select * from public.products where bill_id = p_bill loop
    if p.exchange_until is not null then
      foreach v_off in array array[2, 0] loop
        v_when := private.ist(p.exchange_until - v_off);
        if v_when > now() then
          insert into public.reminders (household_id, ref_type, ref_id, kind, remind_at, title, body, url)
          values (b.household_id, 'bill', b.id, 'exchange', v_when,
                  case v_off when 0 then 'Last day to exchange' else 'Exchange ends in 2 days' end,
                  v_name || ': exchange window ends ' || to_char(p.exchange_until, 'DD Mon'),
                  '/bill/' || b.id);
          v_n := v_n + 1;
        end if;
      end loop;
    end if;
    if p.warranty_until is not null then
      foreach v_off in array array[30, 7, 1] loop
        v_when := private.ist(p.warranty_until - v_off);
        if v_when > now() then
          insert into public.reminders (household_id, ref_type, ref_id, kind, remind_at, title, body, url)
          values (b.household_id, 'bill', b.id, 'warranty', v_when,
                  'Warranty ends in ' || v_off || case v_off when 1 then ' day' else ' days' end,
                  coalesce(p.name, v_name) || ': warranty until ' || to_char(p.warranty_until, 'DD Mon YYYY'),
                  '/bill/' || b.id);
          v_n := v_n + 1;
        end if;
      end loop;
    end if;
  end loop;

  if b.bill_kind = 'laundry' and b.laundry_received_at is null then
    v_pick := coalesce(private.iso_date(b.raw_extraction -> 'promised_date' ->> 'value'),
                       (b.created_at at time zone 'Asia/Kolkata')::date + 3);
    v_when := private.ist(v_pick, '18:00');
    if v_when > now() then
      insert into public.reminders (household_id, ref_type, ref_id, kind, remind_at, title, body, url)
      values (b.household_id, 'bill', b.id, 'laundry_pickup', v_when,
              'Clothes ready for pickup?',
              v_name || coalesce(': ' || (b.raw_extraction -> 'piece_count' ->> 'value') || ' clothes', ''),
              '/bill/' || b.id);
      v_n := v_n + 1;
    end if;
  end if;

  if exists (select 1 from public.vendors v where v.id = b.vendor_id and v.is_recurring)
     and b.bill_kind in ('recurring_milk', 'vendor_credit') and b.total is not null then
    v_when := private.ist((b.created_at at time zone 'Asia/Kolkata')::date + 2);
    if v_when > now() then
      insert into public.reminders (household_id, ref_type, ref_id, kind, remind_at, title, body, url)
      values (b.household_id, 'bill', b.id, 'vendor_due', v_when,
              'Payment due', v_name || ': ₹' || to_char(b.total, 'FM99,99,99,990.00'),
              '/vendors');
      v_n := v_n + 1;
    end if;
  end if;

  return v_n;
end;
$$;

-- Apply a vendor's remembered exchange window to a fashion bill that didn't print one.
create or replace function private.apply_vendor_exchange_default(p_bill uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b public.bills%rowtype; v_days int;
begin
  select * into b from public.bills where id = p_bill;
  if not found or b.bill_kind <> 'retail_fashion' or b.bill_date is null or b.vendor_id is null then
    return;
  end if;
  select exchange_days into v_days from public.vendors where id = b.vendor_id;
  if v_days is null then return; end if;
  if exists (select 1 from public.products where bill_id = p_bill and exchange_until is not null) then
    return;
  end if;
  insert into public.products (bill_id, exchange_until) values (p_bill, b.bill_date + v_days);
end;
$$;

-- One call from the API after every save: vendor, duplicate flag, exchange default, ledger, reminders.
create or replace function public.after_bill_saved(p_bill uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.link_bill_vendor(p_bill);
  perform private.apply_vendor_exchange_default(p_bill);
  perform public.upsert_bill_ledger(p_bill);
  perform public.schedule_bill_reminders(p_bill);
end;
$$;

-- User sets "exchange within N days" for a shop: remembered for future bills from that shop.
create or replace function public.set_vendor_exchange_days(p_bill uuid, p_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b public.bills%rowtype;
begin
  select * into b from public.bills where id = p_bill;
  if not found then raise exception 'bill not found'; end if;
  if b.vendor_id is not null then
    update public.vendors set exchange_days = p_days where id = b.vendor_id;
  end if;
  if b.bill_date is not null then
    update public.products set exchange_until = b.bill_date + p_days where bill_id = p_bill;
    if not found then
      insert into public.products (bill_id, exchange_until) values (p_bill, b.bill_date + p_days);
    end if;
  end if;
  perform public.schedule_bill_reminders(p_bill);
end;
$$;

-- Reminders that are due now, with who should get them. Skips ones made pointless since
-- scheduling (clothes collected, vendor paid, bill deleted/dismissed).
create or replace function public.due_reminders(p_limit int default 100)
returns table (
  id uuid, kind text, title text, body text, url text,
  user_ids uuid[], emails text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.title, r.body, r.url,
         array_agg(m.user_id), array_agg(u.email::text) filter (where u.email is not null)
    from public.reminders r
    join public.members m on m.household_id = r.household_id
    join auth.users u on u.id = m.user_id
    left join public.bills b on r.ref_type = 'bill' and b.id = r.ref_id
   where r.sent_at is null
     and r.dismissed_at is null
     and r.remind_at <= now()
     and r.remind_at > now() - interval '3 days'   -- don't send stale ones after an outage
     and not (r.kind = 'laundry_pickup' and b.laundry_received_at is not null)
     and not (r.kind = 'vendor_due' and exists (
           select 1 from public.vendor_ledger l
            where l.bill_id = b.id and l.amount_paid >= l.amount_due))
   group by r.id
   order by r.remind_at
   limit greatest(p_limit, 1);
$$;

revoke all on function public.upsert_bill_ledger(uuid) from public, anon, authenticated;
revoke all on function public.schedule_bill_reminders(uuid) from public, anon, authenticated;
revoke all on function private.apply_vendor_exchange_default(uuid) from public, anon, authenticated;
revoke all on function public.after_bill_saved(uuid) from public, anon, authenticated;
revoke all on function public.set_vendor_exchange_days(uuid, int) from public, anon, authenticated;
revoke all on function public.due_reminders(int) from public, anon, authenticated;
grant execute on function public.upsert_bill_ledger(uuid) to service_role;
grant execute on function public.schedule_bill_reminders(uuid) to service_role;
grant execute on function private.apply_vendor_exchange_default(uuid) to service_role;
grant execute on function public.after_bill_saved(uuid) to service_role;
grant execute on function public.set_vendor_exchange_days(uuid, int) to service_role;
grant execute on function public.due_reminders(int) to service_role;

-- ───────────── hourly delivery job ─────────────
select cron.schedule(
  'send-reminders',
  '7 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'api_url')
           || '/bills/jobs/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (
    select 1 from public.reminders
    where sent_at is null and dismissed_at is null and remind_at <= now()
  );
  $$
);

-- Advisor fix: pin search_path on the helpers.
alter function private.iso_date(text) set search_path = '';
alter function private.ist(date, time) set search_path = '';
