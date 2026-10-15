-- Local review only. No task/fine data changes; server-authoritative timing.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create temporary table missed_timing_grants on commit drop as select oid,proowner,proacl from pg_proc where oid='public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure;
create function public.task_app_missed_timing_open(t public.tasks,category_name text,at_time timestamptz)
returns boolean language plpgsql immutable set search_path='' as $$
declare day date;weekday integer;created_day date;
begin
 if at_time is null or not isfinite(at_time)then return false;end if;
 day:=(at_time at time zone 'Asia/Kolkata')::date;
 if t.due_date is not null then return t.due_date<=day;end if;
 weekday:=extract(dow from day)::integer;
 if category_name='Sunday Service'then return weekday in(0,1);end if;
 if category_name='Healing Meeting'then return weekday in(3,4);end if;
 if category_name='Revival Meeting'then return weekday in(5,6);end if;
 if category_name<>'Special Meeting'or category_name is null then return false;end if;
 if cardinality(t.weekdays)>0 then return weekday=any(t.weekdays)or extract(dow from day-1)::integer=any(t.weekdays);end if;
 if t.created_at is null or not isfinite(t.created_at)then return false;end if;
 created_day:=(t.created_at at time zone 'Asia/Kolkata')::date;
 return at_time>=t.created_at and day<created_day+2;
end;$$;
revoke all on function public.task_app_missed_timing_open(public.tasks,text,timestamptz)from public,anon,authenticated,service_role;
create or replace function public.task_app_complete_missed(task_id uuid,expected_version timestamptz,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;assignee public.account_members;
 category_name text;at_time timestamptz;activation timestamptz;
begin
 m:=public.task_app_require_role(true);
 if confirmed is distinct from true or task_id is null or expected_version is null or not isfinite(expected_version) then
  raise exception 'Confirm missed completion first' using errcode='23514';end if;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is null then raise exception 'Task changed; refresh first' using errcode='P0409';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 -- Same attendance lock as Mark/Unmark; stabilize the current absence decision.
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||t.assigned_to_member_id::text||':'||t.category_id::text,0));
 perform 1 from public.task_fine_candidates c where c.task_id=t.id for update;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null for update;
 m:=public.task_app_require_role(true);
 at_time:=clock_timestamp();
 if t.id is null or t.updated_at is distinct from expected_version or t.status<>'active'
  or(t.available_at is not null and t.available_at>at_time) then
  raise exception 'Task changed; refresh first' using errcode='P0409';end if;
 if t.assigned_to_member_id is null or t.assigned_to_member_id=m.id then
  raise exception 'Use ordinary completion for your own task' using errcode='P0403';end if;
 select * into assignee from public.account_members where id=t.assigned_to_member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null;
 select name into category_name from public.categories where id=t.category_id and owner_id=m.owner_id;
 if assignee.id is null or category_name not in ('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting') or category_name is null then
  raise exception 'Choose a current assigned meeting task' using errcode='P0409';end if;
 if not public.task_app_missed_timing_open(t,category_name,at_time)then raise exception 'Missed completion is outside the scheduled date or meeting period'using errcode='P0014';end if;
 if exists(select 1 from public.account_member_absences a where a.owner_id=m.owner_id
  and public.task_app_absence_covers(t,a,at_time)) then
  raise exception 'This member marked absence; use Take task instead' using errcode='P0409';end if;
 select enabled_at into activation from public.task_fine_configuration where singleton;
 if activation is null then raise exception 'Fine setup unavailable; no completion saved' using errcode='P0409';end if;
 -- Insert before changing status: deadline assessment races converge on the
 -- existing unique task_id. Paid/cancelled/earlier fines are never overwritten.
 insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at,assessed_at)
 values(m.owner_id,t.id,t.title,category_name,assignee.id,assignee.name,at_time,at_time)
 on conflict on constraint task_fines_task_id_key do nothing;
 update public.tasks set status='completed',missed_completion_role=m.role where id=t.id and owner_id=m.owner_id returning * into t;
 update public.task_fine_candidates c set finalized=true where c.task_id=t.id;
 -- Existing status triggers stamp the actual actor/time, queue just one future
 -- occurrence and add the actor's yearly credit in this same transaction.
 return to_jsonb(t)||jsonb_build_object('series_version',(select max(updated_at)from public.tasks
  where owner_id=m.owner_id and deleted_at is null and(series_id=t.series_id or id=t.id)));
end;$$;
do $$begin
 if exists(select 1 from missed_timing_grants g join pg_proc p on p.oid=g.oid where p.proowner is distinct from g.proowner or p.proacl is distinct from g.proacl)then raise exception 'Existing Missed privileges changed';end if;
end;$$;
notify pgrst,'reload schema';
commit;
