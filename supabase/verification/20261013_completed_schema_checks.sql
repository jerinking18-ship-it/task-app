-- Read-only catalog checks; never invokes a purge or changes application rows.
select
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='task_app_completed' and p.prosecdef and 'search_path=""'=any(p.proconfig)) as scoped_definer,
  has_function_privilege('authenticated','public.task_app_completed(text,bigint,text,boolean)','execute') as member_entry,
  not has_function_privilege('anon','public.task_app_completed(text,bigint,text,boolean)','execute') as anonymous_denied,
  not has_function_privilege('service_role','public.task_app_completed(text,bigint,text,boolean)','execute') as service_role_denied,
  not has_table_privilege('authenticated','public.tasks','delete') as direct_delete_denied,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_repeat_pending' and column_name='source_task_id' and is_nullable='YES') as detached_schedule_supported,
  exists(select 1 from pg_constraint where conrelid='public.task_repeat_pending'::regclass and conname='task_repeat_pending_source_task_id_fkey' and confdeltype='c') as original_cascade_retained;
