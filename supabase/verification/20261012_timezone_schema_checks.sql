-- Read-only checks after the separately approved timezone migration.
-- Reads catalog metadata and row counts only; no user identities/settings values.
with checks (name, passed) as (values
  ('Settings table exists with RLS', (
    select count(*) = 1 and bool_and(relrowsecurity and relkind = 'r')
    from pg_class where oid = to_regclass('public.account_settings')
  )),
  ('Exactly three required columns with expected types', (
    select count(*) = 3 and bool_and(attnotnull and (
      (attname = 'owner_id' and atttypid = 'uuid'::regtype)
      or (attname = 'timezone' and atttypid = 'text'::regtype)
      or (attname = 'created_at' and atttypid = 'timestamptz'::regtype)))
    from pg_attribute where attrelid = 'public.account_settings'::regclass
      and attnum > 0 and not attisdropped
  )),
  ('Session owner and timestamp defaults; no timezone default', (
    select count(*) = 2 and bool_and(
      (adnum = 1 and pg_get_expr(adbin, adrelid) = 'auth.uid()')
      or (adnum = 3 and pg_get_expr(adbin, adrelid) = 'now()'))
    from pg_attrdef where adrelid = 'public.account_settings'::regclass
  )),
  ('One row per account through owner primary key', (
    select count(*) = 1 and bool_and(convalidated and conkey = array[1]::smallint[])
    from pg_constraint where conrelid = 'public.account_settings'::regclass and contype = 'p'
  )),
  ('Auth owner foreign key restricts account deletion', (
    select count(*) = 1 and bool_and(convalidated and conkey = array[1]::smallint[]
      and confrelid = 'auth.users'::regclass and confdeltype = 'r')
    from pg_constraint where conrelid = 'public.account_settings'::regclass and contype = 'f'
  )),
  ('Initial timezone constraint accepts only India', (
    select count(*) = 1 and bool_and(convalidated
      and conname = 'account_settings_timezone_supported'
      and pg_get_constraintdef(oid) = 'CHECK ((timezone = ''Asia/Kolkata''::text))')
    from pg_constraint where conrelid = 'public.account_settings'::regclass and contype = 'c'
  )),
  ('Anonymous table and column privileges denied', (
    not has_table_privilege('anon', 'public.account_settings',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_any_column_privilege('anon', 'public.account_settings',
      'SELECT,INSERT,UPDATE,REFERENCES')
  )),
  ('Authenticated reads and timezone-only inserts', (
    has_table_privilege('authenticated', 'public.account_settings', 'SELECT')
    and not has_table_privilege('authenticated', 'public.account_settings',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and (select bool_and(
      has_column_privilege('authenticated', attrelid, attnum, 'INSERT') = (attname = 'timezone')
      and not has_column_privilege('authenticated', attrelid, attnum, 'UPDATE,REFERENCES'))
      from pg_attribute where attrelid = 'public.account_settings'::regclass
        and attnum > 0 and not attisdropped)
  )),
  ('Exactly expected authenticated select and insert policies', (
    select count(*) = 2 and bool_and(polpermissive
      and polroles = array['authenticated'::regrole::oid]
      and (polname, polcmd::text) in
        (('account_settings_select_own', 'r'), ('account_settings_insert_own', 'a')))
    from pg_policy where polrelid = 'public.account_settings'::regclass
  )),
  ('No account settings were initialized by this migration', (
    select count(*) = 0 from public.account_settings
  ))
)
select bool_and(passed is true) as all_checks_passed, count(*) as checks_run,
  coalesce(jsonb_agg(name order by name) filter (where passed is distinct from true), '[]'::jsonb) as failed_checks,
  (select jsonb_agg(jsonb_build_object('name', polname,
    'using', pg_get_expr(polqual, polrelid),
    'check', pg_get_expr(polwithcheck, polrelid)) order by polname)
   from pg_policy where polrelid = 'public.account_settings'::regclass) as policy_definitions
from checks;
