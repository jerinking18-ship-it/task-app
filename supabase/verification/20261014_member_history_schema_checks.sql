-- Read-only catalog checks; no account/task mutations.
select
 (select relrowsecurity from pg_class where oid='public.member_task_completions'::regclass) as receipt_rls,
 (select relrowsecurity from pg_class where oid='public.member_completion_totals'::regclass) as totals_rls,
 not has_table_privilege('authenticated','public.member_task_completions','SELECT,INSERT,UPDATE,DELETE') as receipt_direct_denied,
 not has_table_privilege('authenticated','public.member_completion_totals','SELECT,INSERT,UPDATE,DELETE') as totals_direct_denied,
 not has_function_privilege('anon','public.task_app_member_history()','EXECUTE') as anon_denied,
 has_function_privilege('authenticated','public.task_app_member_history()','EXECUTE') as report_granted,
 not has_function_privilege('authenticated','public.task_app_history_expires(text,timestamptz,date,smallint[])','EXECUTE') as helper_private,
 not exists(select 1 from pg_constraint where conrelid='public.member_task_completions'::regclass and confrelid='public.tasks'::regclass) as purge_independent,
 exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_count_member_completion' and not tgisinternal) as atomic_count_trigger,
 exists(select 1 from pg_trigger where tgrelid='public.member_completion_totals'::regclass and tgname='member_totals_live_sync' and not tgisinternal) as sync_trigger;
