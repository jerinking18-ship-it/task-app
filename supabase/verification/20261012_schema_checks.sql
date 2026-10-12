-- Read-only catalog checks after the approved migration. No fixture/user data.
with checks (name, passed) as (values
  ('Both tables exist and have RLS', (
    select count(*) = 2 and bool_and(c.relrowsecurity)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('tasks', 'categories') and c.relkind = 'r'
  )),
  ('Expected columns and types', (
    select count(*) = 16 and bool_and(a.atttypid = e.type_name::regtype)
    from (values
      ('categories','id','uuid'), ('categories','owner_id','uuid'),
      ('categories','name','text'), ('categories','created_at','timestamptz'),
      ('tasks','id','uuid'), ('tasks','owner_id','uuid'), ('tasks','title','text'),
      ('tasks','notes','text'), ('tasks','status','text'), ('tasks','due_date','date'),
      ('tasks','due_time','time'), ('tasks','priority','text'), ('tasks','category_id','uuid'),
      ('tasks','created_at','timestamptz'), ('tasks','updated_at','timestamptz'),
      ('tasks','completed_at','timestamptz')
    ) e(table_name, column_name, type_name)
    join pg_attribute a on a.attrelid = to_regclass('public.' || e.table_name)
      and a.attname = e.column_name and not a.attisdropped
  )),
  ('All table constraints are validated', (
    select count(*) = 13 and bool_and(convalidated)
    from pg_constraint where conrelid in ('public.tasks'::regclass, 'public.categories'::regclass)
      and contype <> 'n'
  )),
  ('Category foreign key includes owner and category IDs', (
    select count(*) = 1 and bool_and(conkey = array[2,9]::smallint[]
      and confkey = array[2,1]::smallint[] and confdeltype = 'r')
    from pg_constraint where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_owned_category_fkey' and confrelid = 'public.categories'::regclass
  )),
  ('Seven indexes are valid and ready', (
    select count(*) = 7 and bool_and(indisvalid and indisready)
    from pg_index where indrelid in ('public.tasks'::regclass, 'public.categories'::regclass)
  )),
  ('Both metadata triggers are enabled', (
    select count(*) = 2 and bool_and(tgenabled = 'O') from pg_trigger
    where not tgisinternal and tgrelid in ('public.tasks'::regclass, 'public.categories'::regclass)
      and ((tgname = 'tasks_set_metadata' and tgfoid = 'public.task_app_set_task_metadata()'::regprocedure)
        or (tgname = 'categories_trim_name' and tgfoid = 'public.task_app_trim_category_name()'::regprocedure))
  )),
  ('Trigger functions are invoker functions with empty search paths', (
    select count(*) = 2 and bool_and(not prosecdef and proconfig = array['search_path=""'])
    from pg_proc where oid in ('public.task_app_set_task_metadata()'::regprocedure,
      'public.task_app_trim_category_name()'::regprocedure)
  )),
  ('No anonymous table or column privileges', (
    select bool_and(not has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_any_column_privilege('anon', t, 'SELECT,INSERT,UPDATE,REFERENCES'))
    from unnest(array['public.tasks'::regclass, 'public.categories'::regclass]) t
  )),
  ('Authenticated table access is select only; writes use column grants', (
    select bool_and(has_table_privilege('authenticated', t, 'SELECT')
      and not has_table_privilege('authenticated', t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    from unnest(array['public.tasks'::regclass, 'public.categories'::regclass]) t
  )),
  ('Task column write grants match editable fields exactly', (
    select bool_and(
      has_column_privilege('authenticated', attrelid, attnum, 'INSERT') = (attname in
        ('title','notes','status','due_date','due_time','priority','category_id'))
      and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE') = (attname in
        ('title','notes','status','due_date','due_time','priority','category_id'))
    ) from pg_attribute where attrelid = 'public.tasks'::regclass and attnum > 0 and not attisdropped
  )),
  ('Category column grants allow only name insertion', (
    select bool_and(has_column_privilege('authenticated', attrelid, attnum, 'INSERT') = (attname = 'name')
      and not has_column_privilege('authenticated', attrelid, attnum, 'UPDATE'))
    from pg_attribute where attrelid = 'public.categories'::regclass and attnum > 0 and not attisdropped
  )),
  ('Five owner policies apply only to authenticated', (
    select count(*) = 5 and bool_and(polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
      and polpermissive
      and case when polcmd in ('r','w') then
        pg_get_expr(polqual, polrelid) like '%auth.uid()%owner_id%' else polqual is null end
      and case when polcmd in ('a','w') then
        pg_get_expr(polwithcheck, polrelid) like '%auth.uid()%owner_id%' else polwithcheck is null end)
    from pg_policy where polrelid in ('public.tasks'::regclass, 'public.categories'::regclass)
  )),
  ('Only expected policy names and operations exist', (
    select count(*) = 5 and bool_and(
      (polrelid = 'public.tasks'::regclass and (polname,polcmd::text) in
        (('tasks_select_own','r'),('tasks_insert_own','a'),('tasks_update_own','w')))
      or (polrelid = 'public.categories'::regclass and (polname,polcmd::text) in
        (('categories_select_own','r'),('categories_insert_own','a'))))
    from pg_policy where polrelid in ('public.tasks'::regclass, 'public.categories'::regclass)
  )),
  ('App clients cannot execute trigger functions directly', (
    select bool_and(not has_function_privilege(r, f, 'EXECUTE'))
    from unnest(array['anon','authenticated']) r
    cross join unnest(array['public.task_app_set_task_metadata()'::regprocedure,
      'public.task_app_trim_category_name()'::regprocedure]) f
  )),
  ('Schema remains empty of task and category data', (
    (select count(*) = 0 from public.tasks) and (select count(*) = 0 from public.categories)
  ))
)
select bool_and(passed is true) as all_checks_passed, count(*) as checks_run,
  coalesce(jsonb_agg(name order by name) filter (where passed is distinct from true), '[]'::jsonb) as failed_checks,
  'tasks + categories: private, no sample data' as scope
from checks;
