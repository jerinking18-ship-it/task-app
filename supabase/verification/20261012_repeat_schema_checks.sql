-- Read-only catalog verification. Returns booleans, never task/Auth records.
select
  (select count(*)=7 from information_schema.columns where table_schema='public' and table_name='tasks'
    and column_name in ('repeat_rule','repeat_anchor_day','series_id','occurrence_number','next_occurrence_id','history_at','weekdays')) as repeat_columns,
  (select relrowsecurity from pg_class where oid='public.task_series'::regclass) as series_rls,
  has_function_privilege('authenticated','public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute') as user_mutation,
  not has_function_privilege('anon','public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute') as anon_mutation_denied,
  not has_function_privilege('authenticated','public.task_app_purge_history()','execute') as user_purge_denied,
  not has_function_privilege('anon','public.task_app_purge_history()','execute') as anon_purge_denied,
  not has_function_privilege('service_role','public.task_app_purge_history()','execute') as api_purge_denied,
  not has_column_privilege('authenticated','public.tasks','status','update') as direct_status_update_denied,
  not has_column_privilege('authenticated','public.tasks','history_at','update') as history_metadata_denied,
  (select count(*)=2 from pg_trigger where tgrelid='public.tasks'::regclass
    and tgname in ('tasks_prepare_repeat','tasks_spawn_next') and tgenabled='O') as repeat_triggers;
