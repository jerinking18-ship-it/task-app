-- READ ONLY after separately approved migration020. Every result must be zero.
select 'missing_return_columns' as check_name,2-count(*) as actual
 from information_schema.columns where table_schema='public'and table_name='account_member_absences'
 and column_name in('cancelled_at','previous_expires_at')and data_type='timestamp with time zone'
union all select 'missing_private_self_return_rpc',1-count(*)from pg_proc where pronamespace='public'::regnamespace
 and proname='task_app_unmark_absent'and prosecdef and proconfig @> array['search_path=""']
 and has_function_privilege('authenticated',oid,'execute')and not has_function_privilege('anon',oid,'execute')
 and not has_function_privilege('service_role',oid,'execute')
union all select 'missing_return_notifications',2-count(*)from pg_trigger
 where tgrelid='public.account_member_absences'::regclass and not tgisinternal
 and tgname in('absences_return_members_sync','absences_return_tasks_sync')
union all select 'invalid_return_intervals',count(*)from public.account_member_absences
 where cancelled_at is not null and(cancelled_at<>expires_at or previous_expires_at is null or previous_expires_at<=expires_at)
union all select 'direct_attendance_grants',count(*)from information_schema.table_privileges
 where table_schema='public'and table_name in('account_member_absences','task_coverage_claims')
 and grantee in('PUBLIC','anon','authenticated','service_role');
