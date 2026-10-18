-- Read-only post-install checks. Expected: zero rows. Never installs038.
select 'missing_enabled_status_guard' as issue where not exists(
 select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_aa_meeting_completion_start'and tgenabled='O'and not tgisinternal)
union all select 'missing_completion_helper'where to_regprocedure('public.task_app_completion_open(public.tasks,timestamptz)')is null
union all select 'missing_trigger_helper'where to_regprocedure('public.task_app_guard_completion_start()')is null
union all select 'client_can_execute_private_guard'where exists(
 select 1 from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_completion_open','task_app_guard_completion_start')
 and(has_function_privilege('anon',oid,'execute')or has_function_privilege('authenticated',oid,'execute')or has_function_privilege('service_role',oid,'execute')))
union all select 'unsafe_guard_function'where exists(
 select 1 from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_completion_open','task_app_guard_completion_start')
 and(not prosecdef or not coalesce(proconfig@>array['search_path=""'],false)));
