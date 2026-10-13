-- Read-only catalog checks. No heartbeat, notification or application write.
select
 exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='account_member_presence' and c.relrowsecurity) presence_rls,
 not has_table_privilege('authenticated','public.account_member_presence','select,insert,update,delete') presence_internal,
 has_function_privilege('authenticated','public.task_app_presence(uuid,boolean,bigint)','execute') member_heartbeat,
 not has_function_privilege('anon','public.task_app_presence(uuid,boolean,bigint)','execute') anonymous_denied,
 exists(select 1 from pg_policy where polname='task_app_receive_account_sync' and polrelid='realtime.messages'::regclass) private_topic_policy,
 (select count(*)=6 from pg_trigger where tgname in('tasks_live_sync','categories_live_sync','settings_live_sync','members_live_sync','presence_live_sync','member_sessions_live_sync') and not tgisinternal) notification_triggers,
 has_function_privilege('authenticated','public.task_app_can_receive_sync()','execute') scoped_receive_check,
 not has_function_privilege('anon','public.task_app_can_receive_sync()','execute') anonymous_receive_denied;
