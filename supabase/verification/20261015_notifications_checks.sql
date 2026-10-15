-- Read-only, zero-result counters after NEW 025 only. Never replays migrations.
select count(*) as unexpected_direct_table_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join(values('anon'),('authenticated'),('service_role'))r(role_name)
where n.nspname='public'and c.relname in('task_notifications','task_reopen_requests','task_notification_preferences','task_notification_configuration')
and(not c.relrowsecurity or has_table_privilege(r.role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE'));
select count(*) as unsafe_function_configuration
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'and p.proname in('task_app_init_notification_preferences','task_app_emit_notification','task_app_notify_request_result','task_app_refresh_reopen_requests','task_app_task_notification_events','task_app_claim_notification_event','task_app_fine_notification_event','task_app_role_notification_event','task_app_catchup_notifications','task_app_emit_availability','task_app_absence_notification_event','task_app_notification_snapshot','task_app_notifications','task_app_read_notifications','task_app_save_notification_preferences','task_app_clear_notifications','task_app_request_reopening','task_app_review_reopening')
and(not p.prosecdef or not coalesce(p.proconfig,'{}')@>array['search_path=""']);
select count(*) as unexpected_rpc_access
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join(values('anon'),('authenticated'),('service_role'))r(role_name)
where n.nspname='public'and p.proname in('task_app_init_notification_preferences','task_app_emit_notification','task_app_notify_request_result','task_app_refresh_reopen_requests','task_app_task_notification_events','task_app_claim_notification_event','task_app_fine_notification_event','task_app_role_notification_event','task_app_catchup_notifications','task_app_emit_availability','task_app_absence_notification_event','task_app_notification_snapshot','task_app_notifications','task_app_read_notifications','task_app_save_notification_preferences','task_app_clear_notifications','task_app_request_reopening','task_app_review_reopening')
and has_function_privilege(r.role_name,p.oid,'EXECUTE')is distinct from(r.role_name='authenticated'and p.proname in('task_app_notification_snapshot','task_app_notifications','task_app_read_notifications','task_app_save_notification_preferences','task_app_clear_notifications','task_app_request_reopening','task_app_review_reopening'));
select count(*) as invalid_private_recipient_or_request
from(select n.id from public.task_notifications n left join public.account_members m on m.id=n.recipient_id and m.owner_id=n.owner_id where m.id is null
union all select r.id from public.task_reopen_requests r left join public.account_members a on a.id=r.requester_id and a.owner_id=r.owner_id left join public.account_members b on b.id=r.reviewer_id and b.owner_id=r.owner_id where a.id is null or b.id is null or a.id=b.id)x;
