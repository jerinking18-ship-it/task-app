-- LOCAL DISPOSABLE PostgreSQL ONLY. Never run these fixtures against Supabase.
-- Uses local-bootstrap.sql's simulated identities, not real JWT verification.
begin;

create function pg_temp.assert_timezone(ok boolean, description text)
returns void language plpgsql security invoker as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL: %', description;
  end if;
  raise notice 'PASS: %', description;
end;
$$;

create function pg_temp.expect_timezone_error(statement text, expected_state text, description text)
returns void language plpgsql security invoker as $$
declare caught_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics caught_state = returned_sqlstate;
  end;
  if caught_state is distinct from expected_state then
    raise exception 'FAIL: %, expected %, received %', description, expected_state, caught_state;
  end if;
  raise notice 'PASS: %', description;
end;
$$;

select pg_temp.assert_timezone(
  (select count(*) = 0 from public.account_settings), 'migration creates no settings rows');
select pg_temp.assert_timezone(
  (select relrowsecurity from pg_class where oid = 'public.account_settings'::regclass),
  'settings RLS enabled');
select pg_temp.assert_timezone(
  (select count(*) = 2 and bool_and(polroles = array['authenticated'::regrole::oid])
   from pg_policy where polrelid = 'public.account_settings'::regclass),
  'exactly two policies restricted to authenticated role');
select pg_temp.assert_timezone(
  not has_table_privilege('authenticated', 'public.account_settings',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and has_table_privilege('authenticated', 'public.account_settings', 'SELECT')
  and (select bool_and(
    has_column_privilege('authenticated', attrelid, attnum, 'INSERT') = (attname = 'timezone')
    and not has_column_privilege('authenticated', attrelid, attnum, 'UPDATE'))
    from pg_attribute where attrelid = 'public.account_settings'::regclass
      and attnum > 0 and not attisdropped),
  'authenticated grants allow reads and timezone-only insertion');
select pg_temp.assert_timezone(
  not has_table_privilege('anon', 'public.account_settings',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_any_column_privilege('anon', 'public.account_settings',
    'SELECT,INSERT,UPDATE,REFERENCES'), 'anonymous grants fully revoked');

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
insert into public.account_settings (timezone) values ('Asia/Kolkata');
select pg_temp.assert_timezone(
  (select count(*) = 1 and bool_and(owner_id = auth.uid()
    and timezone = 'Asia/Kolkata' and created_at is not null)
    from public.account_settings), 'owner creates and reads session-owned India setting');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (timezone) values ('Asia/Kolkata')$q$,
  '23505', 'second setting for same account denied');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (owner_id, timezone)
    values ('00000000-0000-4000-8000-000000000002', 'Asia/Kolkata')$q$,
  '42501', 'client cannot supply owner');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (timezone, created_at)
    values ('Asia/Kolkata', '2000-01-01')$q$,
  '42501', 'client cannot supply creation timestamp');
select pg_temp.expect_timezone_error(
  $q$update public.account_settings set timezone = 'Asia/Kolkata'$q$,
  '42501', 'timezone updates denied');
select pg_temp.expect_timezone_error(
  $q$update public.account_settings set owner_id = '00000000-0000-4000-8000-000000000002'$q$,
  '42501', 'ownership updates denied');
select pg_temp.expect_timezone_error(
  $q$update public.account_settings set created_at = now()$q$,
  '42501', 'metadata updates denied');
select pg_temp.expect_timezone_error('delete from public.account_settings',
  '42501', 'settings deletion denied');
select pg_temp.expect_timezone_error('truncate public.account_settings',
  '42501', 'settings truncation denied');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_timezone((select count(*) = 0 from public.account_settings),
  'second account sees none of first account settings');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (timezone) values ('UTC')$q$,
  '23514', 'unapproved timezone denied');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (timezone) values (' Asia/Kolkata ')$q$,
  '23514', 'noncanonical timezone denied');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (timezone) values (null)$q$,
  '23502', 'missing timezone denied');
insert into public.account_settings (timezone) values ('Asia/Kolkata');
select pg_temp.assert_timezone(
  (select count(*) = 1 and bool_and(owner_id = auth.uid()) from public.account_settings),
  'each simulated account has its own setting');

-- Independently test RLS, beyond the stricter production column grants.
-- This temporary grant is rolled back with the whole fixture transaction.
reset role;
grant insert (owner_id) on public.account_settings to authenticated;
set local role authenticated;
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (owner_id, timezone)
    values ('00000000-0000-4000-8000-000000000001', 'Asia/Kolkata')$q$,
  '42501', 'RLS independently denies foreign owner insertion');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.assert_timezone((select count(*) = 0 from public.account_settings),
  'authenticated role without identity reads no settings');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (owner_id, timezone)
    values ('00000000-0000-4000-8000-000000000001', 'Asia/Kolkata')$q$,
  '42501', 'RLS denies owner insertion without identity');

reset role;
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (owner_id, timezone)
    values ('00000000-0000-4000-8000-000000000003', 'Asia/Kolkata')$q$,
  '23503', 'settings require an existing Auth account');
select pg_temp.expect_timezone_error(
  $q$delete from auth.users where id = '00000000-0000-4000-8000-000000000001'$q$,
  '23503', 'account deletion remains restricted until retention is planned');

set local role anon;
select pg_temp.expect_timezone_error('select * from public.account_settings',
  '42501', 'signed-out setting reads denied');
select pg_temp.expect_timezone_error(
  $q$insert into public.account_settings (timezone) values ('Asia/Kolkata')$q$,
  '42501', 'signed-out setting insertion denied');
select pg_temp.expect_timezone_error(
  $q$update public.account_settings set timezone = 'Asia/Kolkata'$q$,
  '42501', 'signed-out setting updates denied');
select pg_temp.expect_timezone_error('delete from public.account_settings',
  '42501', 'signed-out setting deletion denied');

reset role;
rollback;
