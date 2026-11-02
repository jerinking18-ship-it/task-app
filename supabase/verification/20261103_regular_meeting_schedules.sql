-- Read-only postcheck for044. Does not alter tasks, queues, permissions or jobs.
select jsonb_build_object(
 'installed',to_regprocedure('public.task_app_regular_schedule_valid(text,date,text,smallint[])')is not null,
 'enabledTriggers',(select count(*)from pg_trigger where tgname in('tasks_ac_regular_schedule','task_repeat_pending_regular_schedule')and tgenabled='O'and not tgisinternal),
 'issues',array_remove(array[
  case when(select count(*)from pg_trigger where tgname='tasks_ac_regular_schedule'and tgrelid='public.tasks'::regclass and tgenabled='O'and not tgisinternal)<>1 then 'task schedule guard unavailable'end,
  case when(select count(*)from pg_trigger where tgname='task_repeat_pending_regular_schedule'and tgrelid='public.task_repeat_pending'::regclass and tgenabled='O'and not tgisinternal)<>1 then 'queue schedule guard unavailable'end,
  case when exists(select 1 from pg_proc p cross join(values('anon'),('authenticated'),('service_role'))r(role)
   where p.pronamespace='public'::regnamespace and p.proname in('task_app_regular_schedule_valid','task_app_guard_regular_schedule','task_app_guard_regular_pending')and has_function_privilege(r.role,p.oid,'execute'))then 'schedule helper exposed to client role'end,
  case when(select count(*)from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('task_app_regular_schedule_valid','task_app_guard_regular_schedule','task_app_guard_regular_pending'))<>3 then 'schedule helper missing'end
 ],null)
)as schedule_checks;
