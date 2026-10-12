-- SEPARATE HOSTED APPROVAL REQUIRED. Apply migration 005 and verify it first.
-- No credentials, network, extension installation or History cleanup changes.
begin;
do $$ begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise exception 'Supabase Cron must already be enabled'; end if;
  if to_regprocedure('public.task_app_release_scheduled_repeats()') is null then
    raise exception 'Midnight repeat migration must be applied first'; end if;
  if exists(select 1 from cron.job where jobname='bgm-task-midnight-repeats') then
    raise exception 'Job already exists: inspect rather than overwrite'; end if;
end $$;
-- Every minute retries failed/busy midnight work without waiting another day.
-- Worker date gating prevents early generation; 18:30 UTC is 00:00 India time.
select cron.schedule('bgm-task-midnight-repeats','* * * * *',
  'select public.task_app_release_scheduled_repeats();');
commit;
-- Pause only this job: select cron.unschedule('bgm-task-midnight-repeats');
