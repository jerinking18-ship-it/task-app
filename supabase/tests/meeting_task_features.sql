-- DISPOSABLE LOCAL PostgreSQL ONLY, never the hosted project's SQL Editor.
-- psql cwd must be the project root; initializes mock Auth, runs all migrations.
\set ON_ERROR_STOP on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
\i supabase/migrations/202610120001_private_tasks_categories.sql
\i supabase/migrations/202610120002_account_timezone.sql

insert into public.categories (id,owner_id,name) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Personal'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','Work'),
 ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','Shopping'),
 ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000001','Custom category'),
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002','Work'),
 ('00000000-0000-4000-8000-000000000024','00000000-0000-4000-8000-000000000002','Sunday Service');
insert into public.tasks (owner_id,title,notes,status,category_id) values
 ('00000000-0000-4000-8000-000000000001','Old personal task','Keep notes','active','00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-000000000001','Old completed task','Keep completed','completed','00000000-0000-4000-8000-000000000012'),
 ('00000000-0000-4000-8000-000000000001','Custom task','Keep category','active','00000000-0000-4000-8000-000000000014'),
 ('00000000-0000-4000-8000-000000000002','Other old task','Keep other task','active','00000000-0000-4000-8000-000000000021');
\i supabase/migrations/202610120003_task_weekdays_and_deletion.sql

do $$ begin
  assert (select count(*) from public.tasks)=4, 'legacy tasks retained';
  assert (select count(*) from public.tasks where category_id is null)=3, 'old presets moved to Uncategorized';
  assert (select count(*) from public.categories)=2, 'custom and meeting categories retained';
  assert exists(select 1 from public.tasks where title='Old completed task' and status='completed' and completed_at is not null and notes='Keep completed'), 'completed data preserved';
  assert exists(select 1 from public.tasks where title='Custom task' and category_id='00000000-0000-4000-8000-000000000014'), 'custom category retained';
end $$;

set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
do $$ declare before_count bigint; count_updated bigint; original_version timestamptz; target uuid; begin
  assert (select count(*) from public.tasks)=3, 'owner RLS applies';
  assert public.task_app_valid_weekdays('{}'::smallint[]), 'no days valid';
  assert public.task_app_valid_weekdays('{0,1,2,3,4,5,6}'::smallint[]), 'all days valid';
  assert not public.task_app_valid_weekdays('{0,0}'::smallint[]), 'duplicate day rejected';
  assert not public.task_app_valid_weekdays('{7}'::smallint[]), 'out of range rejected';
  assert not public.task_app_valid_weekdays('{null}'::smallint[]), 'null day rejected';
  assert not public.task_app_valid_weekdays('{{0,1},{2,3}}'::smallint[]), 'multidimensional rejected';
  insert into public.tasks(title,weekdays) values ('Weekday labels',array[0,3]::smallint[]) returning id,updated_at into target,original_version;
  assert exists(select 1 from public.tasks where id=target and due_date is null and weekdays='{0,3}'::smallint[]), 'days need no due date';
  select count(*) into before_count from public.tasks;
  begin
    insert into public.tasks(title,weekdays) values ('Valid batch member','{0}'::smallint[]),('Invalid batch member','{7}'::smallint[]);
    raise exception 'invalid batch unexpectedly succeeded';
  exception when check_violation then null; end;
  assert (select count(*) from public.tasks)=before_count, 'batch rolled back entirely';
  begin
    insert into public.tasks(title,category_id) values ('First member',null),('Other owner category','00000000-0000-4000-8000-000000000024');
    raise exception 'foreign owner category unexpectedly succeeded';
  exception when foreign_key_violation then null; end;
  assert (select count(*) from public.tasks)=before_count, 'foreign category batch rolled back';
  begin
    insert into public.tasks(title,owner_id) values ('Forbidden owner','00000000-0000-4000-8000-000000000002');
    raise exception 'owner write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  update public.tasks set deleted_at=now() where id=target and updated_at=original_version-interval '1 second' and deleted_at is null;
  get diagnostics count_updated=row_count;
  assert count_updated=0, 'stale delete cannot change row';
  update public.tasks set deleted_at=now() where id=target and updated_at=original_version and deleted_at is null;
  get diagnostics count_updated=row_count;
  assert count_updated=1, 'current version soft delete succeeds';
  assert exists(select 1 from public.tasks where id=target and deleted_at is not null), 'deleted record retained';
  assert not exists(select 1 from public.tasks where id=target and deleted_at is null), 'visible query hides deleted record';
  update public.tasks set title='Resurrected' where id=target and deleted_at is null;
  get diagnostics count_updated=row_count;
  assert count_updated=0, 'normal update excludes deleted record';
  update public.tasks set deleted_at=now() where owner_id='00000000-0000-4000-8000-000000000002';
  get diagnostics count_updated=row_count;
  assert count_updated=0, 'cannot delete another owner task';
  begin
    delete from public.tasks where id=target;
    raise exception 'hard delete unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform * from public.tasks;
    raise exception 'anonymous task read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: legacy migration, weekdays, atomic batches, RLS, versioned retained deletion, anonymous denial' as result;
