-- Local until publication approval. Sunday Morning normal and Missed completion close at 6 PM IST.
-- No task/attendance/fine rows, check-in hours, grants or scheduled jobs change.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.task_app_guard_regular_schedule()')is null then
  raise exception 'Install reviewed001–044 first';end if;
 if position('Sunday Morning completion cutoff045' in pg_get_functiondef('public.task_app_completion_open(public.tasks,timestamptz)'::regprocedure))>0 then
  raise exception '045 already installed; never replay';end if;
 if exists(select 1 from pg_proc p cross join(values('anon'),('authenticated'),('service_role'))r(role_name)
  where p.oid in('public.task_app_completion_open(public.tasks,timestamptz)'::regprocedure,'public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure)
  and has_function_privilege(r.role_name,p.oid,'execute'))then raise exception 'Unexpected completion helper access';end if;
end;$$;
lock table public.tasks in share row exclusive mode;
create temporary table sunday_completion_grants on commit drop as
 select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid in(
 'public.task_app_completion_open(public.tasks,timestamptz)'::regprocedure,
 'public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure);
create function pg_temp.patch_sunday_completion(target regprocedure,before_text text,after_text text)
returns void language plpgsql as $$declare definition text;begin
 definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>1 then
  raise exception 'Unexpected completion function baseline; no changes applied';end if;
 execute replace(definition,before_text,after_text);
end;$$;
select pg_temp.patch_sunday_completion('public.task_app_completion_open(public.tasks,timestamptz)',
 $before$ if t.due_date is null then return extract(dow from today)::integer in(weekday,weekday+1);end if;$before$,
 $after$ -- Sunday Morning completion cutoff045: only this occurrence's Sunday, before 18:00 IST.
 if category_name='Sunday Service'and t.sunday_service='morning'then
  if t.due_date is null then
   return extract(dow from today)::integer=0 and(at_time at time zone 'Asia/Kolkata')::time<time '18:00';
  end if;
  if not isfinite(t.due_date)then return false;end if;
  distance:=extract(dow from t.due_date)::integer;
  if distance>1 then return false;end if;
  meeting_day:=t.due_date-distance;
  return at_time>=meeting_day::timestamp at time zone 'Asia/Kolkata'
   and at_time<(meeting_day::timestamp+interval '18 hours')at time zone 'Asia/Kolkata';
 end if;
 if t.due_date is null then return extract(dow from today)::integer in(weekday,weekday+1);end if;$after$);
select pg_temp.patch_sunday_completion('public.task_app_missed_timing_open(public.tasks,text,timestamptz)',
 $before$local_stamp::time>=time '16:00'$before$,$after$local_stamp::time>=time '18:00'$after$);
do $$begin
 if exists(select 1 from sunday_completion_grants g join pg_proc p on p.oid=g.oid
  where p.proowner is distinct from g.proowner or p.proacl is distinct from g.proacl
  or p.prosecdef is distinct from g.prosecdef or p.proconfig is distinct from g.proconfig)then
  raise exception 'Completion helper security changed';end if;
end;$$;
drop function pg_temp.patch_sunday_completion(regprocedure,text,text);
notify pgrst,'reload schema';
commit;
