-- READ ONLY after separately approved018. Every result should be zero.
select 'incorrect_template_bin_rpc' as check_name,1-count(*) as actual from pg_proc
 where oid='public.task_app_deleted_templates()'::regprocedure and prosecdef and proconfig @> array['search_path=""']
 and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
 and pg_get_functiondef(oid)like '%task_app_require_role(true)%'
 and pg_get_functiondef(oid)like '%deleted_by_member_id%'
union all select 'incorrect_scoped_member_names_rpc',1-count(*)from pg_proc
 where oid='public.task_app_member_names()'::regprocedure and prosecdef and provolatile='s'and proconfig @> array['search_path=""']
 and has_function_privilege('authenticated',oid,'execute')and not has_function_privilege('anon',oid,'execute')
 and not has_function_privilege('service_role',oid,'execute')and pg_get_functiondef(oid)like '%task_app_workspace_owner()%'
union all select 'public_legacy_helpers',count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'task_app_legacy_%'
 and (has_function_privilege('anon',oid,'execute')or has_function_privilege('authenticated',oid,'execute'));
