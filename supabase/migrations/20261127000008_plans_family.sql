-- Phase 5: scan quota, Razorpay payments, family invites.
-- Money and credits change only through service-role functions (the API).

-- ───────────── quota state ─────────────
alter table public.households
  add column if not exists free_month date,
  add column if not exists free_used  int not null default 0,
  add column if not exists plan_until timestamptz;

-- Owners may rename their household, nothing else (credits/plan were writable before).
revoke update on public.households from anon, authenticated;
grant update (name) on public.households to authenticated;

alter table public.bills add column if not exists quota_blocked boolean not null default false;
alter table public.members add column if not exists joined_at timestamptz not null default now();

-- One row per bill that used a scan. Members can read; nobody but the API writes.
create table if not exists public.scan_charges (
  bill_id      uuid primary key references public.bills (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  kind         text not null check (kind in ('free', 'credit')),
  charged_at   timestamptz not null default now()
);
create index if not exists scan_charges_household_idx on public.scan_charges (household_id);
alter table public.scan_charges enable row level security;
create policy scan_charges_select on public.scan_charges for select
  using (private.is_member(household_id));

-- ───────────── payments ─────────────
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  plan                text not null,
  amount_paise        int not null check (amount_paise > 0),
  credits             int not null check (credits >= 0),
  razorpay_order_id   text not null unique,
  razorpay_payment_id text,
  status              text not null default 'created' check (status in ('created', 'paid', 'failed')),
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index if not exists payments_household_idx on public.payments (household_id);
create index if not exists payments_user_idx on public.payments (user_id);
alter table public.payments enable row level security;
create policy payments_select on public.payments for select
  using (private.is_member(household_id));

-- ───────────── family invites ─────────────
create table if not exists public.household_invites (
  token        text primary key default replace(gen_random_uuid()::text, '-', ''),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz
);
create index if not exists household_invites_household_idx on public.household_invites (household_id);
create index if not exists household_invites_created_by_idx on public.household_invites (created_by);
create index if not exists household_invites_used_by_idx on public.household_invites (used_by);
alter table public.household_invites enable row level security;
-- Only the owner creates and sees invite links for their household.
create policy household_invites_owner on public.household_invites for select
  using (exists (select 1 from public.households h where h.id = household_id and h.owner_id = (select auth.uid())));
create policy household_invites_insert on public.household_invites for insert
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.households h
                           where h.id = household_id and h.owner_id = (select auth.uid())));

-- ───────────── quota functions (service role) ─────────────
create or replace function private.free_limit() returns int language sql immutable set search_path = '' as $$ select 5 $$;

create or replace function private.member_limit(p_plan text, p_until timestamptz)
returns int language sql stable set search_path = '' as $$
  select case when p_plan = 'family' and coalesce(p_until, now()) >= now() then 6 else 2 end
$$;

-- Charge one scan for a bill (once per bill; re-reads are free).
-- Returns 'already' | 'free' | 'credit' | 'none' (out of scans).
create or replace function public.charge_scan(p_bill uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household uuid;
  h public.households%rowtype;
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  v_kind text;
begin
  select household_id into v_household from public.bills where id = p_bill;
  if v_household is null then
    return 'none';
  end if;
  if exists (select 1 from public.scan_charges where bill_id = p_bill) then
    return 'already';
  end if;

  select * into h from public.households where id = v_household for update;
  if h.free_month is distinct from v_month then
    update public.households set free_month = v_month, free_used = 0 where id = h.id;
    h.free_used := 0;
  end if;

  if h.free_used < private.free_limit() then
    update public.households set free_used = free_used + 1 where id = h.id;
    v_kind := 'free';
  elsif h.scan_credits > 0 then
    update public.households set scan_credits = scan_credits - 1 where id = h.id;
    v_kind := 'credit';
  else
    update public.bills set quota_blocked = true where id = p_bill;
    return 'none';
  end if;

  insert into public.scan_charges (bill_id, household_id, kind) values (p_bill, h.id, v_kind)
    on conflict (bill_id) do nothing;
  update public.bills set quota_blocked = false where id = p_bill and quota_blocked;
  return v_kind;
end;
$$;

-- Payment captured (verify handler or webhook; idempotent). Returns true when credited now.
create or replace function public.apply_payment(p_order text, p_payment text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments%rowtype;
begin
  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment, paid_at = now()
   where razorpay_order_id = p_order and status <> 'paid'
  returning * into p;
  if not found then
    return false;
  end if;

  update public.households
     set scan_credits = scan_credits + p.credits,
         plan = case when p.plan = 'family' then 'family'
                     when plan = 'free' then 'pack' else plan end,
         plan_until = case when p.plan = 'family'
                           then greatest(coalesce(plan_until, now()), now()) + interval '1 year'
                           else plan_until end
   where id = p.household_id;
  return true;
end;
$$;

-- ───────────── family functions (signed-in users) ─────────────
-- What the join screen shows: household name and who invited.
create or replace function public.invite_info(p_token text)
returns table (household_name text, invited_by text, valid boolean)
language sql
stable
security definer
set search_path = public
as $$
  select h.name,
         coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
         (i.used_by is null and i.expires_at > now())
    from public.household_invites i
    join public.households h on h.id = i.household_id
    left join auth.users u on u.id = i.created_by
   where i.token = p_token
$$;

-- Join a household from an invite link. Returns the household id.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.household_invites%rowtype;
  h public.households%rowtype;
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into i from public.household_invites where token = p_token for update;
  if not found or i.expires_at <= now() or (i.used_by is not null and i.used_by <> v_user) then
    raise exception 'invite invalid or expired' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members where household_id = i.household_id and user_id = v_user) then
    update public.members set joined_at = now() where household_id = i.household_id and user_id = v_user;
    return i.household_id;
  end if;

  select * into h from public.households where id = i.household_id;
  if (select count(*) from public.members where household_id = h.id) >= private.member_limit(h.plan, h.plan_until) then
    raise exception 'family is full' using errcode = 'P0002';
  end if;

  insert into public.members (household_id, user_id, role, joined_at) values (h.id, v_user, 'member', now());
  update public.household_invites set used_by = v_user, used_at = now() where token = p_token;
  return h.id;
end;
$$;

-- Members of my household with display names (for the Family screen).
create or replace function public.household_members(p_household uuid)
returns table (user_id uuid, role text, name text, email text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.role,
         coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
         u.email, m.joined_at
    from public.members m
    join auth.users u on u.id = m.user_id
   where m.household_id = p_household
     and private.is_member(p_household)
   order by m.role desc, m.joined_at
$$;

revoke all on function public.charge_scan(uuid) from public, anon, authenticated;
revoke all on function public.apply_payment(text, text) from public, anon, authenticated;
revoke all on function public.invite_info(text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.household_members(uuid) from public, anon;
revoke all on function private.free_limit() from public, anon;
revoke all on function private.member_limit(text, timestamptz) from public, anon;
grant execute on function public.charge_scan(uuid) to service_role;
grant execute on function public.apply_payment(text, text) to service_role;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.household_members(uuid) to authenticated;
grant execute on function private.free_limit() to authenticated, service_role;
grant execute on function private.member_limit(text, timestamptz) to authenticated, service_role;
