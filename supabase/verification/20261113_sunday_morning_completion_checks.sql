-- Read-only post-install verification. Expected zero rows.
select 'missing_morning_completion_cutoff045' as issue where not exists(
 select 1 from pg_proc where oid=to_regprocedure('public.task_app_completion_open(public.tasks,timestamptz)')
 and prosrc like '%Sunday Morning completion cutoff045%'and prosrc like '%18 hours%')
union all select 'incorrect_morning_missed_cutoff'where not exists(
 select 1 from pg_proc where oid=to_regprocedure('public.task_app_missed_timing_open(public.tasks,text,timestamptz)')
 and prosrc like '%local_stamp::time>=time ''18:00''%')
union all select 'client_can_execute_completion_helper'where exists(
 select 1 from pg_proc where oid in(to_regprocedure('public.task_app_completion_open(public.tasks,timestamptz)'),
 to_regprocedure('public.task_app_missed_timing_open(public.tasks,text,timestamptz)'))
 and(has_function_privilege('anon',oid,'execute')or has_function_privilege('authenticated',oid,'execute')or has_function_privilege('service_role',oid,'execute')))
union all select 'missing_completion_transition_guard'where not exists(
 select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_aa_meeting_completion_start'and tgenabled='O')
union all select 'missing_completion_check_in_guard'where not exists(
 select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_ab_completion_check_in'and tgenabled='O');
