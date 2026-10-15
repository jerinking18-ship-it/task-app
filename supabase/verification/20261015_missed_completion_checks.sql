-- Read-only post-rollout checks; every violations value must be zero.
select 'missed_rpc_access' as check_name,
 (case when has_function_privilege('authenticated','public.task_app_complete_missed(uuid,timestamptz,boolean)','execute')
  and not has_function_privilege('anon','public.task_app_complete_missed(uuid,timestamptz,boolean)','execute')
  and not has_function_privilege('service_role','public.task_app_complete_missed(uuid,timestamptz,boolean)','execute')
  and exists(select 1 from pg_proc where oid='public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure
    and prosecdef and proconfig @> array['search_path=""']) then 0 else 1 end)::bigint as violations
union all
select 'missed_row_invariants',count(*)from public.tasks
 where missed_completion_role is not null and(status<>'completed' or completed_by_member_id is null
  or assigned_to_member_id is null or assigned_to_member_id=completed_by_member_id or missed_completion_role not in('owner','coordinator'))
union all
select 'missed_credit_invariants',count(*)from public.tasks t
 left join public.member_task_completions c on c.owner_id=t.owner_id and c.task_id=t.id
 where t.status='completed'and t.missed_completion_role is not null
 and(c.task_id is null or not c.counted or not c.missed_completion or c.member_id<>t.completed_by_member_id
  or c.completion_year<>extract(year from t.completed_at at time zone 'Asia/Kolkata')::integer)
union all
select 'missed_private_helpers',count(*)from pg_proc
 where oid in('public.task_app_set_completion_member()'::regprocedure,'public.task_app_count_member_completion()'::regprocedure,
 'public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure)
 and(has_function_privilege('anon',oid,'execute')or has_function_privilege('authenticated',oid,'execute')or has_function_privilege('service_role',oid,'execute'));
