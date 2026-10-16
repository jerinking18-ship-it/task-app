-- Read-only AFTER new030. Every violations result must be zero.
select 'missed_window_helper_private',count(*)from(values('anon'),('authenticated'),('service_role'))r(role_name)
 where has_function_privilege(r.role_name,'public.task_app_missed_timing_open(public.tasks,text,timestamptz)','execute');
select 'missed_window_boundaries',count(*)from(values
 ('Sunday Service','2026-10-18','2026-10-18T18:59:59.999999+05:30'::timestamptz,false),
 ('Sunday Service','2026-10-18','2026-10-18T19:00:00+05:30',true),
 ('Sunday Service','2026-10-18','2026-10-19T00:59:59.999999+05:30',true),
 ('Sunday Service','2026-10-18','2026-10-19T01:00:00+05:30',false),
 ('Sunday Service','2026-10-18','2026-10-25T19:00:00+05:30',false),
 ('Healing Meeting','2026-10-21','2026-10-21T19:00:00+05:30',true),
 ('Healing Meeting','2026-10-21','2026-10-22T01:00:00+05:30',false),
 ('Revival Meeting','2026-10-23','2026-10-23T19:00:00+05:30',true),
 ('Revival Meeting','2026-10-23','2026-10-24T01:00:00+05:30',false),
 ('Special Meeting','2026-10-24','2026-10-24T19:00:00+05:30',true),
 ('Special Meeting','2026-10-24','2026-10-25T01:00:00+05:30',false)
)v(category,meeting_date,at_time,want)
 where public.task_app_missed_timing_open(jsonb_populate_record(null::public.tasks,jsonb_build_object('due_date',meeting_date)),category,at_time)is distinct from want;
select 'missed_rpc_checks_clock_after_locks',case when
 position('at_time := clock_timestamp()'in replace(pg_get_functiondef('public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure),'at_time:=','at_time := '))>0
 and position('task_app_missed_timing_open'in pg_get_functiondef('public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure))>0
 then 0 else 1 end;
