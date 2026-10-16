-- New030 only. Local implementation: publish separately after verification.
-- Narrows Missed timing; normal completion/reopening/fines and data stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if position('return t.due_date<=day;'in pg_get_functiondef('public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure))=0 then
  raise exception 'Missed timing already changed; never replay030';end if;
 if exists(select 1 from(values('anon'),('authenticated'),('service_role'))r(role_name)where has_function_privilege(r.role_name,'public.task_app_missed_timing_open(public.tasks,text,timestamptz)','execute'))then
  raise exception 'Unexpected Missed helper access';end if;
end;$$;
create temporary table missed_window_grants on commit drop as select oid,proowner,proacl from pg_proc where oid in('public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure,'public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure);
create or replace function public.task_app_missed_timing_open(t public.tasks,category_name text,at_time timestamptz)
returns boolean language plpgsql immutable set search_path='' as $$
declare local_stamp timestamp;day date;meeting_day date;weekday integer;target integer;distance integer;created_day date;morning boolean;
begin
 if at_time is null or not isfinite(at_time)then return false;end if;
 local_stamp:=at_time at time zone 'Asia/Kolkata';day:=local_stamp::date;
 morning:=category_name='Sunday Service'and t.sunday_service='morning';
 if coalesce(morning,false)then
  if local_stamp::time<time '09:00'or local_stamp::time>=time '16:00'then return false;end if;
  meeting_day:=day;
 else
  if local_stamp::time>=time '01:00'and local_stamp::time<time '19:00'then return false;end if;
  meeting_day:=case when local_stamp::time<time '01:00'then day-1 else day end;
 end if;
 if t.due_date is not null and(t.due_date>day or t.due_date>date '9999-12-22')then return false;end if;
 weekday:=extract(dow from meeting_day)::integer;
 target:=case category_name when 'Sunday Service'then 0 when 'Healing Meeting'then 3 when 'Revival Meeting'then 5 else null end;
 if target is not null then
  if weekday<>target then return false;end if;
  if t.due_date is null then return true;end if;
  distance:=(extract(dow from t.due_date)::integer-target+7)%7;
  return distance<=1 and meeting_day=t.due_date-distance;
 end if;
 if category_name is distinct from 'Special Meeting'then return false;end if;
 if t.due_date is not null then return meeting_day=t.due_date;end if;
 if cardinality(t.weekdays)>0 then return weekday=any(t.weekdays);end if;
 if t.created_at is null or not isfinite(t.created_at)then return false;end if;
 created_day:=(t.created_at at time zone 'Asia/Kolkata')::date;
 return at_time>=t.created_at and meeting_day=created_day;
end;$$;
-- CREATE OR REPLACE preserves the private helper's owner/ACL and the existing
-- RPC continues to check fresh clock_timestamp() after acquiring its locks.
do $$begin
 if exists(select 1 from missed_window_grants g join pg_proc p on p.oid=g.oid where p.proowner is distinct from g.proowner or p.proacl is distinct from g.proacl)then raise exception 'Existing Missed privileges changed';end if;
end;$$;
notify pgrst,'reload schema';
commit;
