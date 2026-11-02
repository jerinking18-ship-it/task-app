-- Read-only post-install checks. Expected zero rows. Never installs or rewrites data.
select 'missing_enabled_completion_check_in_guard' as issue where not exists(
 select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_ab_completion_check_in'
 and tgenabled='O'and not tgisinternal and tgtype=19
 and tgfoid=to_regprocedure('public.task_app_guard_completion_check_in()'))
union all select 'missing_check_in_helper'where to_regprocedure('public.task_app_has_completion_check_in(public.tasks,uuid,timestamptz)')is null
union all select 'missing_check_in_trigger_function'where to_regprocedure('public.task_app_guard_completion_check_in()')is null
union all select 'client_can_execute_private_check_in_guard'where exists(
 select 1 from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_has_completion_check_in','task_app_guard_completion_check_in')
 and(has_function_privilege('anon',oid,'execute')or has_function_privilege('authenticated',oid,'execute')or has_function_privilege('service_role',oid,'execute')))
union all select 'unsafe_completion_check_in_function'where exists(
 select 1 from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_has_completion_check_in','task_app_guard_completion_check_in')
 and(not prosecdef or not coalesce(proconfig@>array['search_path=""'],false)));
