-- Read-only checks AFTER new027–029; every violations result should be zero.
select 'service_helpers_private',count(*)from pg_proc p cross join(values('anon'),('authenticated'),('service_role'))r(role_name)
 where p.oid in('public.task_app_absence_service_covers(public.account_member_absences,text,timestamptz)'::regprocedure,
 'public.task_app_service_attendance_open(text,timestamptz)'::regprocedure,'public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure)
 and has_function_privilege(r.role_name,p.oid,'execute');
select 'service_rpc_privileges',count(*)from pg_proc p where p.oid in('public.task_app_mark_service_absent(uuid,text,boolean)'::regprocedure,
 'public.task_app_unmark_service_absent(uuid,timestamptz,text,boolean)'::regprocedure)
 and(not p.prosecdef or not has_function_privilege('authenticated',p.oid,'execute')or has_function_privilege('anon',p.oid,'execute')or has_function_privilege('service_role',p.oid,'execute'));
select 'retention_private',count(*)from(values('anon'),('authenticated'),('service_role'))r(role_name)
 where has_table_privilege(r.role_name,'public.task_retention_configuration','select,insert,update,delete')
 or has_function_privilege(r.role_name,'public.task_app_purge_history()','execute');
select 'absence_service_integrity',count(*)from public.account_member_absences a join public.categories c on c.id=a.category_id and c.owner_id=a.owner_id
 where(c.name<>'Sunday Service'and(a.sunday_service is not null or a.morning_returned_at is not null or a.evening_returned_at is not null))
 or(a.sunday_service is not null and(a.morning_returned_at is not null or a.evening_returned_at is not null));
select 'fine_service_snapshots',count(*)from public.task_fine_candidates where(category_name='Sunday Service'and sunday_service is null)
 or(category_name<>'Sunday Service'and sunday_service is not null);
select 'scoped_attendance_boundaries',count(*)from(values
 ('morning','2026-10-18T00:00:00+05:30'::timestamptz,true),('morning','2026-10-18T11:00:00+05:30',false),
 ('evening','2026-10-18T12:59:59+05:30',false),('evening','2026-10-18T13:00:00+05:30',true),('evening','2026-10-18T21:00:00+05:30',false))v(service,at_time,want)
 where public.task_app_service_attendance_open(service,at_time)is distinct from want;
select 'unchanged_monday_fine_cutoff',case when public.task_app_fine_cutoff('Sunday Service','2026-10-18','23:50')='2026-10-19T01:00:00+05:30'::timestamptz then 0 else 1 end;
select 'unchanged_sunday_expiry',case when public.task_app_history_expires('Sunday Service','2026-10-18T10:00:00+05:30',null,'{}')='2026-10-20T00:00:00+05:30'::timestamptz then 0 else 1 end;
