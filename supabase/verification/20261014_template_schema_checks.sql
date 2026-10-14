-- Read-only rollout checks. No task, template or Auth rows are changed.
select
 (select relrowsecurity from pg_class where oid='public.task_templates'::regclass) as templates_rls,
 exists(select 1 from pg_policies where schemaname='public' and tablename='task_templates' and policyname='task_templates_member_read') as member_read_policy,
 has_table_privilege('authenticated','public.task_templates','SELECT') as member_read_granted,
 not has_table_privilege('anon','public.task_templates','SELECT') as anon_read_denied,
 not has_table_privilege('authenticated','public.task_templates','INSERT,UPDATE,DELETE') as direct_writes_denied,
 has_function_privilege('authenticated','public.task_app_save_template(uuid,timestamptz,text,jsonb)','EXECUTE') as save_rpc_granted,
 not has_function_privilege('anon','public.task_app_save_template(uuid,timestamptz,text,jsonb)','EXECUTE') as anon_rpc_denied,
 exists(select 1 from pg_trigger where tgrelid='public.task_templates'::regclass and tgname='templates_live_sync' and not tgisinternal) as private_sync_trigger;
