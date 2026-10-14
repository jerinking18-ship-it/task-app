-- READ ONLY. Every actual value should be zero after reviewed migration019.
select 'public_fine_tables' as check_name,count(*)as actual from pg_class where relnamespace='public'::regnamespace
 and relname in('task_fines','task_fine_candidates','task_fine_configuration')
 and(not relrowsecurity or has_table_privilege('authenticated',oid,'select,insert,update,delete')or has_table_privilege('anon',oid,'select,insert,update,delete'))
union all select 'public_private_fine_helpers',count(*)from pg_proc where pronamespace='public'::regnamespace
 and proname in('task_app_fine_cutoff','task_app_finalize_fine','task_app_track_fine','task_app_fine_before_change','task_app_fine_after_change','task_app_assess_fines','task_app_assess_scheduled_fines','task_app_enable_fines')
 and(has_function_privilege('authenticated',oid,'execute')or has_function_privilege('anon',oid,'execute')or has_function_privilege('service_role',oid,'execute'))
union all select 'incorrect_fine_rpcs',2-count(*)from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_fines','task_app_settle_fine')
 and prosecdef and proconfig @> array['search_path=""']and has_function_privilege('authenticated',oid,'execute')and not has_function_privilege('anon',oid,'execute')
 and pg_get_functiondef(oid)like '%task_app_require_role(true)%'
union all select 'duplicate_occurrence_fines',count(*)from(select task_id from public.task_fines group by task_id having count(*)>1)x
union all select 'invalid_fine_amounts',count(*)from public.task_fines where amount_paise<>5000;
