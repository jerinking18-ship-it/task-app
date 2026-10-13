-- Read-only deployment verification. Run only after approved006 +007 rollout.
with flags as (select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='account_members' and column_name='left_at' and data_type='timestamp with time zone') as archive_column,
  exists(select 1 from pg_indexes where schemaname='public' and indexname='account_members_unique_name' and indexdef like '%WHERE (left_at IS NULL)%') as active_name_uniqueness,
  exists(select 1 from pg_policies where schemaname='public' and tablename='account_members' and policyname='account_members_owner_read' and qual like '%left_at IS NULL%') as active_member_policy,
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.task_app_rename_member(text,text)'::regprocedure,'public.task_app_leave_member()'::regprocedure)) as protected_profile_rpcs,
  has_function_privilege('authenticated','public.task_app_rename_member(text,text)','execute') and has_function_privilege('authenticated','public.task_app_leave_member()','execute') as authenticated_profile_actions,
  not has_function_privilege('anon','public.task_app_rename_member(text,text)','execute') and not has_function_privilege('anon','public.task_app_leave_member()','execute') as anonymous_denied,
  not has_function_privilege('service_role','public.task_app_rename_member(text,text)','execute') and not has_function_privilege('service_role','public.task_app_leave_member()','execute') as service_role_denied,
  not has_column_privilege('authenticated','public.account_members','left_at','update') and not has_column_privilege('authenticated','public.account_members','name','update') as direct_profile_writes_denied,
  not has_table_privilege('authenticated','public.account_member_sessions','select') as session_bindings_private,
  exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_completion_member' and not tgisinternal) as completion_trigger_retained,
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.account_members'::regclass,'public.account_member_sessions'::regclass,'public.tasks'::regclass,'public.categories'::regclass,'public.account_settings'::regclass)) as row_security_retained
)
select *, (select bool_and(value::boolean) from jsonb_each_text(to_jsonb(flags))) as all_checks_pass from flags;
