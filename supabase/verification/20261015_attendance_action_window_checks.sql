-- Read-only: every violation count must be zero after023.
with examples(category,meeting_day)as(values
 ('Sunday Service',date '2026-10-18'),('Healing Meeting',date '2026-10-21'),
 ('Revival Meeting',date '2026-10-23'),('Special Meeting',date '2026-12-31'))
select 'meeting_day_action_windows'check_name,count(*)violations from examples where
 not public.task_app_attendance_change_open(category,meeting_day,(meeting_day+time '00:00')at time zone 'Asia/Kolkata')
 or not public.task_app_attendance_change_open(category,meeting_day,(meeting_day+time '20:59:59.999999')at time zone 'Asia/Kolkata')
 or public.task_app_attendance_change_open(category,meeting_day,(meeting_day+time '21:00')at time zone 'Asia/Kolkata')
 or public.task_app_attendance_change_open(category,meeting_day,((meeting_day+1)+time '12:00')at time zone 'Asia/Kolkata')
union all select 'private_clock_helper',count(*)from(values('anon'),('authenticated'),('service_role'))r(role)
 where has_function_privilege(role,'public.task_app_attendance_change_open(text,date,timestamptz)','EXECUTE')
union all select 'existing_attendance_rpc_access',count(*)from(values('anon'),('authenticated'),('service_role'))r(role)
 cross join(values('public.task_app_mark_absent(uuid,date,boolean)'),('public.task_app_unmark_absent(uuid,timestamptz,boolean)'))f(signature)
 where has_function_privilege(role,signature,'EXECUTE')is distinct from(role='authenticated')
union all select 'server_clock_window_enforcement',count(*)from(values('public.task_app_mark_absent(uuid,date,boolean)'),('public.task_app_unmark_absent(uuid,timestamptz,boolean)'))f(signature)
 where position('task_app_attendance_change_open' in pg_get_functiondef(signature::regprocedure))=0
 or position('clock_timestamp()' in pg_get_functiondef(signature::regprocedure))=0;
