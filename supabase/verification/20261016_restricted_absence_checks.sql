-- Read-only AFTER new030 + new031. Every violations result must be zero.
select 'restriction_helper_private',count(*)from(values('anon'),('authenticated'),('service_role'))r(role_name)
 where has_function_privilege(r.role_name,'public.task_app_restriction_covers(public.tasks,public.account_member_absences,timestamptz)','execute');
select 'absence_table_private',count(*)from(values('anon'),('authenticated'),('service_role'))r(role_name)
 where has_table_privilege(r.role_name,'public.account_member_absences','insert,update,delete');
select 'restriction_provenance',count(*)from public.account_member_absences a where
 (a.restriction_role is null)<>(a.restriction_actor_id is null)
 or(a.restriction_role is not null and(a.restriction_role not in('owner','coordinator')or not exists(select 1 from public.account_members m where m.id=a.restriction_actor_id and m.owner_id=a.owner_id)));
select 'morning_window',count(*)from(values
 ('2026-10-18T08:59:59.999999+05:30'::timestamptz,false),('2026-10-18T09:00:00+05:30',true),
 ('2026-10-18T15:59:59.999999+05:30',true),('2026-10-18T16:00:00+05:30',false),
 ('2026-10-18T19:00:00+05:30',false),('2026-10-19T00:30:00+05:30',false),('2026-10-25T10:00:00+05:30',false)
)v(at_time,want)where public.task_app_missed_timing_open(jsonb_populate_record(null::public.tasks,'{"due_date":"2026-10-18","sunday_service":"morning"}'),'Sunday Service',at_time)is distinct from want;
select 'fine_forced_absence_not_exempt',case when position('a.restriction_role is null'in pg_get_functiondef('public.task_app_finalize_fine(uuid,timestamptz)'::regprocedure))>0 then 0 else 1 end;
select 'restriction_rpc_verified_manager',case when
 position('task_app_require_role(true)'in pg_get_functiondef('public.task_app_remove_restriction(uuid,timestamptz,boolean)'::regprocedure))>0
 and has_function_privilege('authenticated','public.task_app_remove_restriction(uuid,timestamptz,boolean)','execute')
 and not has_function_privilege('anon','public.task_app_remove_restriction(uuid,timestamptz,boolean)','execute')then 0 else 1 end;
select 'private_mutation_guard',case when position('task_app_restriction_covers'in pg_get_functiondef('public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure))>0
 and not has_function_privilege('authenticated','public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute')then 0 else 1 end;
