-- Review and apply separately only after approved migration019 deployment.
-- Requires Supabase Cron (pg_cron) already available; no extension/plan changes here.
begin;
set local lock_timeout='10s';set local statement_timeout='60s';
do $$begin
 if to_regprocedure('cron.schedule(text,text,text)')is null then raise exception 'Enable Supabase Cron before activating fines';end if;
 if to_regprocedure('public.task_app_enable_fines()')is null then raise exception 'Apply reviewed migration019 first';end if;
 if exists(select 1 from cron.job where jobname='task-app-meeting-fines'and(command<>'select public.task_app_assess_scheduled_fines();'or schedule<>'* * * * *'or not active))then raise exception 'Existing fine cron differs; review before replacing it';end if;
 if not exists(select 1 from cron.job where jobname='task-app-meeting-fines')then
  perform cron.schedule('task-app-meeting-fines','* * * * *','select public.task_app_assess_scheduled_fines();');
 end if;
end;$$;
-- Start prospectively, at this server time. Never resets an existing activation.
select public.task_app_enable_fines();
commit;
