-- Read-only catalog and metadata checks; no task/account writes.
select
 (select relrowsecurity from pg_class where oid='public.task_templates'::regclass) as templates_rls,
 not has_table_privilege('authenticated','public.task_templates','INSERT,UPDATE,DELETE') as direct_writes_denied,
 exists(select 1 from pg_policies where schemaname='public' and tablename='task_templates' and policyname='task_templates_member_read' and qual like '%deleted_at IS NULL%') as active_only_read,
 has_function_privilege('authenticated','public.task_app_remove_template(uuid,timestamptz,boolean)','EXECUTE') as remove_granted,
 has_function_privilege('authenticated','public.task_app_deleted_templates()','EXECUTE') as bin_read_granted,
 has_function_privilege('authenticated','public.task_app_bin_items(text,jsonb,boolean)','EXECUTE') as mixed_bin_granted,
 not has_function_privilege('anon','public.task_app_remove_template(uuid,timestamptz,boolean)','EXECUTE') as anon_remove_denied,
 not has_function_privilege('anon','public.task_app_deleted_templates()','EXECUTE') as anon_bin_read_denied,
 not has_function_privilege('anon','public.task_app_bin_items(text,jsonb,boolean)','EXECUTE') as anon_mixed_denied,
 not has_function_privilege('service_role','public.task_app_bin_items(text,jsonb,boolean)','EXECUTE') as service_mixed_denied,
 exists(select 1 from pg_constraint where conrelid='public.task_templates'::regclass and conname='templates_deleted_member_owner') as member_owner_fk,
 exists(select 1 from pg_constraint where conrelid='public.task_templates'::regclass and conname='templates_deleted_metadata') as deletion_metadata_constraint,
 exists(select 1 from pg_trigger where tgrelid='public.task_templates'::regclass and tgname='templates_live_sync' and not tgisinternal) as private_sync_trigger,
 (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.task_app_remove_template(uuid,timestamptz,boolean)'::regprocedure,'public.task_app_deleted_templates()'::regprocedure,'public.task_app_bin_items(text,jsonb,boolean)'::regprocedure)) as pinned_definer_functions;
