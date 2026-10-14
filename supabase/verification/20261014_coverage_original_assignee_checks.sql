-- READ ONLY, after separately approved migration017. All results should be zero.
select 'missing_scoped_origin_rpc' as check_name,1-count(*) as actual from pg_proc
 where oid='public.task_app_coverage_origins()'::regprocedure
 and prosecdef and provolatile='s' and proconfig @> array['search_path=""']
 and has_function_privilege('authenticated',oid,'execute')
 and not has_function_privilege('anon',oid,'execute')
 and not has_function_privilege('service_role',oid,'execute')
union all select 'direct_claim_grants',count(*) from information_schema.table_privileges
 where table_schema='public' and table_name='task_coverage_claims' and grantee in ('PUBLIC','anon','authenticated','service_role')
union all select 'claim_identity_mismatches',count(*) from public.task_coverage_claims c
 join public.account_members original on original.id=c.original_member_id
 join public.account_members helper on helper.id=c.taken_by_member_id
 where c.original_member_id=c.taken_by_member_id or original.owner_id<>c.owner_id or helper.owner_id<>c.owner_id;
