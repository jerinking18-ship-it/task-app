-- Read-only checks; no task/account writes.
select
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='member_task_completions' and column_name='counted' and data_type='boolean' and is_nullable='NO') as counted_flag,
 not has_table_privilege('authenticated','public.member_task_completions','SELECT,INSERT,UPDATE,DELETE') as receipt_private,
 not has_function_privilege('authenticated','public.task_app_count_member_completion()','EXECUTE') as trigger_private,
 exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_count_member_completion' and not tgisinternal) as atomic_trigger,
 not exists(select 1 from public.member_completion_totals t where t.completed_count<>(select count(*) from public.member_task_completions r where r.owner_id=t.owner_id and r.member_id=t.member_id and r.completion_year=t.completion_year and r.counted)) as totals_match_receipts,
 not exists(select 1 from public.member_task_completions r join public.tasks t on t.id=r.task_id and t.owner_id=r.owner_id where t.status='active' and r.counted) as reopened_not_counted;
