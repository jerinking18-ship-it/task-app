-- SEPARATE ACTION-TIME APPROVAL REQUIRED: permanent Activity deletion after 7 days.
-- Includes existing and future Activity records; preserves all source app records.
-- Migration035 must already be installed. Does not enable extensions or other jobs.
begin;
do $$begin
 if to_regprocedure('cron.schedule(text,text,text)')is null then raise exception 'Supabase Cron must already be available';end if;
 if to_regprocedure('public.task_app_purge_activity()')is null then raise exception 'Install migration035 first';end if;
 if not exists(select 1 from public.task_activity_retention_configuration where singleton)then raise exception 'Activity retention configuration is missing';end if;
 if exists(select 1 from public.task_activity_retention_configuration where enabled_at is not null)then raise exception 'Activity retention already active; inspect instead of replaying';end if;
 if exists(select 1 from cron.job where jobname='bgm-task-activity-cleanup')then raise exception 'Activity cleanup job already exists; inspect instead of replacing';end if;
end;$$;
-- Physical deletion occurs on the next hourly run after 168 elapsed hours.
-- The Activity reader excludes expired rows immediately, including All time.
select cron.schedule('bgm-task-activity-cleanup','0 * * * *','select public.task_app_purge_activity();');
update public.task_activity_retention_configuration set enabled_at=statement_timestamp()where singleton and enabled_at is null;
commit;
