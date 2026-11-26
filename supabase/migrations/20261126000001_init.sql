-- billvault: core schema, RLS, signup trigger, private storage bucket.
-- Every row is scoped by household_id; access is via membership in that household.

create extension if not exists pg_trgm;

-- ───────────────────────── tables ─────────────────────────

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'My home',
  owner_id    uuid not null references auth.users (id) on delete cascade,
  plan        text not null default 'free' check (plan in ('free', 'pack', 'family')),
  scan_credits int not null default 0,
  created_at  timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index members_user_idx on public.members (user_id);

create table public.vendors (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  phone        text,
  upi_vpa      text,
  category     text,
  is_recurring boolean not null default false,
  created_at   timestamptz not null default now()
);
create index vendors_household_idx on public.vendors (household_id);
create index vendors_name_trgm on public.vendors using gin (name gin_trgm_ops);

create table public.bills (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  created_by     uuid references auth.users (id) on delete set null,
  vendor_id      uuid references public.vendors (id) on delete set null,
  status         text not null default 'processing'
                 check (status in ('uploading', 'processing', 'done', 'failed')),
  source         text not null default 'camera'
                 check (source in ('camera', 'gallery', 'pdf', 'share', 'import')),
  page_paths     text[] not null default '{}',
  hints          jsonb,
  bill_kind      text,
  vendor_name    text,
  bill_date      date,
  bill_no        text,
  total          numeric(12, 2),
  tax            numeric(12, 2),
  is_handwritten boolean,
  total_mismatch boolean not null default false,
  needs_fix      boolean not null default false,
  raw_extraction jsonb,
  validation     jsonb,
  prompt_version text,
  cost_inr       numeric(10, 4),
  batch_id       text,
  error          text,
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index bills_household_created_idx on public.bills (household_id, created_at desc);
create index bills_status_idx on public.bills (status) where status = 'processing';
create index bills_vendor_trgm on public.bills using gin (vendor_name gin_trgm_ops);

create table public.bill_items (
  id      uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  position int not null default 0,
  name    text not null,
  qty     numeric(12, 3),
  unit    text,
  rate    numeric(12, 2),
  amount  numeric(12, 2)
);
create index bill_items_bill_idx on public.bill_items (bill_id);
create index bill_items_name_trgm on public.bill_items using gin (name gin_trgm_ops);

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references public.bills (id) on delete cascade,
  name            text,
  brand           text,
  model           text,
  serial_no       text,
  product_barcode text,
  warranty_until  date,
  exchange_until  date
);
create index products_bill_idx on public.products (bill_id);

create table public.vendor_ledger (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  month       date not null, -- first day of month
  amount_due  numeric(12, 2) not null default 0,
  amount_paid numeric(12, 2) not null default 0,
  paid_on     date,
  unique (vendor_id, month)
);

create table public.reminders (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  ref_type     text not null,
  ref_id       uuid not null,
  remind_at    timestamptz not null,
  channel      text not null default 'push' check (channel in ('push', 'email')),
  sent_at      timestamptz
);
create index reminders_due_idx on public.reminders (remind_at) where sent_at is null;

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────── helpers ─────────────────────────

create or replace function public.is_member(hid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members m where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger bills_touch before update on public.bills
  for each row execute function public.touch_updated_at();

-- New user → own household as owner.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare hid uuid;
begin
  insert into public.households (owner_id) values (new.id) returning id into hid;
  insert into public.members (household_id, user_id, role) values (hid, new.id, 'owner');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── RLS ─────────────────────────

alter table public.households         enable row level security;
alter table public.members            enable row level security;
alter table public.vendors            enable row level security;
alter table public.bills              enable row level security;
alter table public.bill_items         enable row level security;
alter table public.products           enable row level security;
alter table public.vendor_ledger      enable row level security;
alter table public.reminders          enable row level security;
alter table public.push_subscriptions enable row level security;

create policy households_select on public.households for select using (public.is_member(id));
create policy households_update on public.households for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy members_select on public.members for select using (public.is_member(household_id));

create policy vendors_all on public.vendors for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Clients may create bills (status uploading/processing) and read/delete them.
-- Extraction results are written by the API with the service role.
create policy bills_select on public.bills for select using (public.is_member(household_id));
create policy bills_insert on public.bills for insert
  with check (public.is_member(household_id) and created_by = auth.uid()
              and status in ('uploading', 'processing'));
create policy bills_update on public.bills for update
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy bills_delete on public.bills for delete using (public.is_member(household_id));

create policy bill_items_all on public.bill_items for all
  using (exists (select 1 from public.bills b where b.id = bill_id and public.is_member(b.household_id)))
  with check (exists (select 1 from public.bills b where b.id = bill_id and public.is_member(b.household_id)));

create policy products_all on public.products for all
  using (exists (select 1 from public.bills b where b.id = bill_id and public.is_member(b.household_id)))
  with check (exists (select 1 from public.bills b where b.id = bill_id and public.is_member(b.household_id)));

create policy vendor_ledger_all on public.vendor_ledger for all
  using (exists (select 1 from public.vendors v where v.id = vendor_id and public.is_member(v.household_id)))
  with check (exists (select 1 from public.vendors v where v.id = vendor_id and public.is_member(v.household_id)));

create policy reminders_select on public.reminders for select using (public.is_member(household_id));

create policy push_own on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────── storage ─────────────────────────
-- Private bucket; object path = <household_id>/<bill_id>/<page>.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bills', 'bills', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy bills_objects_select on storage.objects for select
  using (bucket_id = 'bills' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy bills_objects_insert on storage.objects for insert
  with check (bucket_id = 'bills' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy bills_objects_delete on storage.objects for delete
  using (bucket_id = 'bills' and public.is_member(((storage.foldername(name))[1])::uuid));
