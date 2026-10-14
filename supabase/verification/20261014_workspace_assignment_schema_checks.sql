-- READ ONLY. After migration015 and separately approved initial Owner bootstrap.
select 'verified_workspaces' as check_name,count(*) as actual from public.task_workspaces w
 where exists(select 1 from public.account_members m join auth.users u on u.id=m.auth_user_id
 where m.owner_id=w.owner_id and m.role='owner' and m.left_at is null and u.email_confirmed_at is not null)
union all select 'workspaces_without_exactly_one_owner',count(*) from public.task_workspaces w
 where (select count(*) from public.account_members m where m.owner_id=w.owner_id and m.role='owner' and m.left_at is null)<>1
union all select 'unassigned_tasks',count(*) from public.tasks t join public.task_workspaces w using(owner_id) where t.assigned_to_member_id is null
union all select 'unassigned_repeat_series',count(*) from public.task_series s join public.task_workspaces w using(owner_id) where s.assigned_to_member_id is null
union all select 'over_capacity_workspaces',count(*) from public.task_workspaces w where
 (select count(*) from public.account_members m where m.owner_id=w.owner_id and m.left_at is null)+
 (select count(*) from public.workspace_invitations i where i.owner_id=w.owner_id and i.accepted_at is null and i.revoked_at is null and i.expires_at>statement_timestamp())>10
union all select 'public_legacy_mutations',count(*) from pg_proc p where p.pronamespace='public'::regnamespace
 and p.proname like 'task_app_legacy_%' and has_function_privilege('authenticated',p.oid,'execute')
union all select 'public_bootstrap',has_function_privilege('authenticated','public.task_app_bootstrap_workspace(uuid,text)','execute')::integer
union all select 'public_profile_picker',has_function_privilege('authenticated','public.task_app_choose_member(uuid,text)','execute')::integer
union all select 'direct_task_write_grants',count(*) from information_schema.column_privileges where table_schema='public'
 and table_name='tasks' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','REFERENCES')
union all select 'unprotected_workspace_tables',count(*) from pg_class where oid in ('public.task_workspaces'::regclass,'public.workspace_invitations'::regclass)
 and not relrowsecurity;
