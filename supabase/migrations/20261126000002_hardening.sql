-- Fixes from the Supabase security + performance advisors after the init migration.

-- 1. Helper functions out of the API-exposed schema.
--    is_member() is SECURITY DEFINER; in `public` it was callable as /rest/v1/rpc/is_member.
--    Policies reference functions by OID, so they keep working after the move.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

alter function public.is_member(uuid) set schema private;
revoke all on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated, service_role;

-- Trigger-only function: nobody needs to call it directly.
alter function public.handle_new_user() set schema private;
revoke all on function private.handle_new_user() from public, anon, authenticated;

-- 2. Pin search_path on the remaining trigger function.
alter function public.touch_updated_at() set search_path = '';

-- 3. Extension out of `public` (existing trigram indexes stay bound by OID).
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- 4. Evaluate auth.uid() once per query, not per row.
drop policy households_update on public.households;
create policy households_update on public.households for update
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy bills_insert on public.bills;
create policy bills_insert on public.bills for insert
  with check (private.is_member(household_id) and created_by = (select auth.uid())
              and status in ('uploading', 'processing'));

drop policy push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 5. Cover foreign keys used in joins / cascades.
create index if not exists bills_created_by_idx on public.bills (created_by);
create index if not exists bills_vendor_idx on public.bills (vendor_id);
create index if not exists households_owner_idx on public.households (owner_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index if not exists reminders_household_idx on public.reminders (household_id);
