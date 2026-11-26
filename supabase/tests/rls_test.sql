-- RLS isolation test: user A must not see user B's household or bills.
-- Run against a local Supabase (supabase start) with:
--   psql "$DB_URL" -f supabase/tests/rls_test.sql
-- Exits with an error if isolation is broken. Everything is rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local');

-- Trigger created a household for each user.
do $$
declare ha uuid; hb uuid;
begin
  select household_id into ha from public.members where user_id = '00000000-0000-0000-0000-00000000000a';
  select household_id into hb from public.members where user_id = '00000000-0000-0000-0000-00000000000b';
  if ha is null or hb is null or ha = hb then
    raise exception 'signup trigger did not create separate households';
  end if;
  insert into public.bills (household_id, created_by, vendor_name)
    values (hb, '00000000-0000-0000-0000-00000000000b', 'B secret bill');
  perform set_config('test.hb', hb::text, true);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.households) <> 1 then
    raise exception 'user A sees % households (expected 1)', (select count(*) from public.households);
  end if;
  if exists (select 1 from public.bills where vendor_name = 'B secret bill') then
    raise exception 'user A can read user B bills';
  end if;
  begin
    insert into public.bills (household_id, created_by)
      values (current_setting('test.hb')::uuid, '00000000-0000-0000-0000-00000000000a');
    raise exception 'user A inserted a bill into user B household';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;
  raise notice 'RLS isolation OK';
end $$;

rollback;
