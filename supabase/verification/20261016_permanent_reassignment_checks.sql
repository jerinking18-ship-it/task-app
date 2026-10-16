-- Read-only AFTER migration032. Every violations result must be zero.
select 'permanent_rpc_verified_manager',case when
 position('task_app_require_role(true)'in pg_get_functiondef('public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure))>0
 and has_function_privilege('authenticated','public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute')
 and not has_function_privilege('anon','public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute')
 and not has_function_privilege('service_role','public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute')then 0 else 1 end;
select 'permanent_rpc_definer_path',count(*)from pg_proc p where p.oid='public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure
 and(not p.prosecdef or p.proconfig is distinct from array['search_path=""']);
select 'legacy_mutations_private',count(*)from pg_proc p where p.pronamespace='public'::regnamespace
 and p.proname like 'task_app_legacy_%'and has_function_privilege('authenticated',p.oid,'execute');
select 'permanent_assignee_workspace',count(*)from public.task_series s where s.assigned_to_member_id is not null
 and not exists(select 1 from public.account_members m where m.owner_id=s.owner_id and m.id=s.assigned_to_member_id);
