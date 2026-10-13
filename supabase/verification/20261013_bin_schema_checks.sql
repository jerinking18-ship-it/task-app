-- Read-only catalog checks, no tasks/member names/Auth data.
with flags as(select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='deleted_by_name') as deletion_metadata,
  exists(select 1 from pg_indexes where schemaname='public' and indexname='tasks_owner_bin_idx') as bin_index,
  exists(select 1 from pg_indexes where schemaname='public' and indexname='task_series_bin_restart_once') as one_resume_per_series,
  exists(select 1 from pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_deleted_member_owner') as attribution_owner_fk,
  exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_bin_stamp' and not tgisinternal) as server_deletion_stamp,
  has_function_privilege('authenticated','public.task_app_bin(text,jsonb,boolean)','execute') as authenticated_bin_rpc,
  not has_function_privilege('anon','public.task_app_bin(text,jsonb,boolean)','execute') as anonymous_denied,
  not has_function_privilege('service_role','public.task_app_bin(text,jsonb,boolean)','execute') as service_role_denied,
  not has_function_privilege('authenticated','public.task_app_mutate_before_bin(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute') as old_mutator_private,
  not has_table_privilege('authenticated','public.tasks','delete') as direct_delete_denied,
  not has_column_privilege('authenticated','public.tasks','deleted_at','update') as direct_restore_denied,
  not has_column_privilege('authenticated','public.tasks','deleted_by_name','insert') as metadata_spoof_denied,
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in('public.task_app_bin(text,jsonb,boolean)'::regprocedure,'public.task_app_bin_stamp()'::regprocedure)) as protected_search_paths,
  (select bool_and(relrowsecurity) from pg_class where oid in('public.tasks'::regclass,'public.task_series'::regclass,'public.account_members'::regclass)) as rls_retained,
  (select position('DELETED_AT IS NULL' in upper(pg_get_functiondef('public.task_app_purge_history()'::regprocedure)))>0) as bin_excluded_from_history_cleanup
)
select *, (select bool_and(value::boolean) from jsonb_each_text(to_jsonb(flags))) as all_checks_pass from flags;
