-- Read-only booleans, no task/Auth records.
select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='tasks'
    and column_name='available_at') as availability_column,
  (select relrowsecurity from pg_class where oid='public.task_repeat_pending'::regclass) as pending_rls,
  not has_table_privilege('authenticated','public.task_repeat_pending','select') as pending_read_denied,
  not has_table_privilege('authenticated','public.task_repeat_pending','insert') as pending_write_denied,
  has_function_privilege('authenticated','public.task_app_release_my_repeats()','execute') as owner_catchup_allowed,
  not has_function_privilege('anon','public.task_app_release_my_repeats()','execute') as anon_catchup_denied,
  not has_function_privilege('authenticated','public.task_app_release_repeats(uuid,timestamptz)','execute') as arbitrary_clock_denied,
  not has_function_privilege('authenticated','public.task_app_release_scheduled_repeats()','execute') as global_worker_denied,
  not has_function_privilege('service_role','public.task_app_release_scheduled_repeats()','execute') as api_global_worker_denied,
  not has_function_privilege('authenticated','public.task_app_mutate_task(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute') as mutation_bypass_denied,
  not has_column_privilege('authenticated','public.tasks','available_at','insert') as availability_managed,
  not has_function_privilege('authenticated','public.task_app_purge_history()','execute') as purge_still_denied;
