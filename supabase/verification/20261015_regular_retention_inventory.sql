-- Read-only inventory before separately approving irreversible activation.
-- Does not change configuration, schedule a job or delete anything.
select count(*)as eligible_regular_completions,
 md5(coalesce(string_agg(id::text||':'||updated_at::text||':'||completed_at::text,'|'order by id),''))as eligible_snapshot
 from public.tasks where status='completed'and deleted_at is null and completed_at<=statement_timestamp()-interval '7 days'
 and history_at is null and repeat_rule='off'and series_id is null and next_occurrence_id is null;
