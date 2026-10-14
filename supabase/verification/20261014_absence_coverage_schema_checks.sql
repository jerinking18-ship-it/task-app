-- READ ONLY. Run only after separately approved additive migration016.
-- Every result should be zero; no task or attendance content is returned.
select 'unprotected_attendance_tables' as check_name,count(*) as actual from pg_class
 where oid in ('public.account_member_absences'::regclass,'public.task_coverage_claims'::regclass) and not relrowsecurity
union all select 'direct_attendance_grants',count(*) from information_schema.table_privileges
 where table_schema='public' and table_name in ('account_member_absences','task_coverage_claims') and grantee in ('PUBLIC','anon','authenticated','service_role')
union all select 'public_private_helpers',count(*) from pg_proc where pronamespace='public'::regnamespace
 and (proname like 'task_app_legacy_%' or proname='task_app_absence_covers') and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))
union all select 'missing_scoped_rpcs',4-count(*) from pg_proc where pronamespace='public'::regnamespace
 and proname in ('task_app_available_coverage','task_app_mark_absent','task_app_take_task','task_app_mutate') and prosecdef and proconfig @> array['search_path=""'] and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
union all select 'missing_absence_notifications',2-count(*) from pg_trigger
 where tgrelid='public.account_member_absences'::regclass and tgname in ('absences_members_sync','absences_tasks_sync') and not tgisinternal
union all select 'cross_workspace_absences',count(*) from public.account_member_absences a join public.account_members m on m.id=a.member_id where a.owner_id<>m.owner_id
union all select 'cross_workspace_claims',count(*) from public.task_coverage_claims c join public.tasks t on t.id=c.task_id join public.account_member_absences a on a.id=c.absence_id
 where c.owner_id<>t.owner_id or c.owner_id<>a.owner_id or c.original_member_id<>a.member_id;
