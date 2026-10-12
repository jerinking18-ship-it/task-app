-- SEPARATE ACTION-TIME APPROVAL REQUIRED. Activates permanent deletion.
-- First apply migration 004 and verify owner isolation. Supabase Cron must
-- already be enabled by an approved dashboard action. This file enables no
-- extension, uses no key/network call, and never runs an immediate purge.
begin;
do $$ begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise exception 'Enable Supabase Cron after approval, then retry'; end if;
  if to_regprocedure('public.task_app_purge_history()') is null then
    raise exception 'Repeat/History migration must be applied first'; end if;
  if exists(select 1 from cron.job where jobname='bgm-task-history-cleanup') then
    raise exception 'Job already exists: inspect it rather than overwrite'; end if;
end $$;
-- Hourly checks delete only completed occurrences with 30 full days in History.
-- Deletion happens within one hour after eligibility, even when the app is closed.
select cron.schedule('bgm-task-history-cleanup','0 * * * *',
  'select public.task_app_purge_history();');
commit;

-- Approved pause/reversal of scheduling: select cron.unschedule('bgm-task-history-cleanup');
-- Unscheduling stops future runs; previously purged records cannot be restored
-- through the app. Never disable the entire Cron extension or other jobs.
