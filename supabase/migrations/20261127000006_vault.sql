-- Phase 3: duplicate detection, vendor auto-linking, search.

-- ───────────── duplicates ─────────────
-- image_hash: 64-bit perceptual hash (dHash, 16 hex chars) of page 1, computed on the phone.
-- duplicate_of: set by link_bill_vendor() when vendor + date + total match another bill.
alter table public.bills add column if not exists image_hash text;
alter table public.bills add column if not exists duplicate_of uuid references public.bills (id) on delete set null;
create index if not exists bills_household_hash_idx on public.bills (household_id, image_hash)
  where image_hash is not null;
create index if not exists bills_duplicate_of_idx on public.bills (duplicate_of);
create index if not exists vendors_household_phone_idx on public.vendors (household_id, phone);

-- ───────────── vendor auto-linking ─────────────
-- Called by the API (service role) after a bill is saved.
-- Match order: phone → UPI VPA → name similarity (≥ 0.6). Creates the vendor if none matches.
create or replace function public.link_bill_vendor(p_bill uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b        public.bills%rowtype;
  v_phone  text;
  v_vpa    text;
  v_name   text;
  v_id     uuid;
  v_cat    text;
begin
  select * into b from public.bills where id = p_bill;
  if not found then
    return null;
  end if;

  v_phone := nullif(regexp_replace(coalesce(b.raw_extraction -> 'vendor_phone' ->> 'value', ''), '\D', '', 'g'), '');
  v_vpa   := nullif(lower(coalesce(b.hints -> 'upi' ->> 'pa', '')), '');
  v_name  := nullif(btrim(coalesce(b.vendor_name, b.hints -> 'upi' ->> 'pn', '')), '');

  if v_phone is not null then
    select id into v_id from public.vendors
     where household_id = b.household_id and phone = v_phone limit 1;
  end if;
  if v_id is null and v_vpa is not null then
    select id into v_id from public.vendors
     where household_id = b.household_id and lower(upi_vpa) = v_vpa limit 1;
  end if;
  if v_id is null and v_name is not null then
    select id into v_id from public.vendors
     where household_id = b.household_id and similarity(lower(name), lower(v_name)) >= 0.6
     order by similarity(lower(name), lower(v_name)) desc limit 1;
  end if;

  v_cat := case b.bill_kind
    when 'recurring_milk'  then 'milk'
    when 'laundry'         then 'laundry'
    when 'textile_kaccha'  then 'textile'
    when 'electronics'     then 'electronics'
    when 'retail_fashion'  then 'fashion'
    when 'vendor_credit'   then 'kirana'
    when 'medical_consult' then 'medical'
    when 'hospital'        then 'hospital'
    else 'general'
  end;

  if v_id is null and v_name is not null then
    insert into public.vendors (household_id, name, phone, upi_vpa, category, is_recurring)
    values (b.household_id, v_name, v_phone, v_vpa, v_cat,
            b.bill_kind in ('recurring_milk', 'laundry', 'vendor_credit'))
    returning id into v_id;
  elsif v_id is not null then
    -- Fill gaps on an existing vendor; never overwrite what the user may have renamed.
    update public.vendors
       set phone   = coalesce(phone, v_phone),
           upi_vpa = coalesce(upi_vpa, v_vpa),
           is_recurring = is_recurring or b.bill_kind in ('recurring_milk', 'laundry', 'vendor_credit')
     where id = v_id;
  end if;

  update public.bills
     set vendor_id = v_id,
         duplicate_of = (
           select o.id from public.bills o
            where o.household_id = b.household_id
              and o.id <> b.id
              and o.created_at < b.created_at
              and b.total is not null and o.total = b.total
              and b.bill_date is not null and o.bill_date = b.bill_date
              and lower(coalesce(o.vendor_name, '')) = lower(coalesce(b.vendor_name, ''))
            order by o.created_at
            limit 1)
   where id = b.id;

  return v_id;
end;
$$;

revoke all on function public.link_bill_vendor(uuid) from public, anon, authenticated;
grant execute on function public.link_bill_vendor(uuid) to service_role;

-- ───────────── search ─────────────
-- Words are parsed on the phone ("blue shirt zudio october milk"):
--   kinds  → bill_kind filter (e.g. milk → recurring_milk)
--   month / year → bill date (or upload date when unknown)
--   words  → every word must match vendor, bill no., or an item name
-- SECURITY INVOKER: row level security still decides what the user can see.
create or replace function public.search_bills(
  words   text[] default '{}',
  kinds   text[] default '{}',
  p_month int    default null,
  p_year  int    default null,
  p_limit int    default 50
)
returns setof public.bills
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select b.*
    from public.bills b
   where (cardinality(kinds) = 0 or b.bill_kind = any (kinds))
     and (p_month is null or extract(month from coalesce(b.bill_date, b.created_at::date)) = p_month)
     and (p_year  is null or extract(year  from coalesce(b.bill_date, b.created_at::date)) = p_year)
     and not exists (
       select 1 from unnest(words) w
        where not coalesce(
             b.vendor_name ilike '%' || w || '%'
          or b.bill_no ilike '%' || w || '%'
          or word_similarity(w, coalesce(b.vendor_name, '')) >= 0.5
          or exists (select 1 from public.bill_items i where i.bill_id = b.id and i.name ilike '%' || w || '%'),
          false)  -- NULL vendor/bill no. must count as "no match", not "unknown"
     )
   order by coalesce(b.bill_date, b.created_at::date) desc, b.created_at desc
   limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.search_bills(text[], text[], int, int, int) from public, anon;
grant execute on function public.search_bills(text[], text[], int, int, int) to authenticated;
