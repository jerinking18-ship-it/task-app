-- LOCAL ONLY. Move a shared Special Meeting schedule without losing progress.
-- Requires installed036. Does not activate meetings, install jobs or delete data.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
do $$begin
 if to_regclass('public.task_special_meetings')is null then raise exception 'Install036 first';end if;
 if exists(select 1 from pg_attribute where attrelid='public.task_special_activations'::regclass and attname='scheduled_start')then raise exception '037 already installed; never replay';end if;
end;$$;
lock table public.tasks,public.task_special_meetings,public.task_special_plans,public.task_special_activations in access exclusive mode;
-- Historical replacement exemptions must keep the dates that were activated,
-- even after the meeting is moved to a different week.
alter table public.task_special_activations add column scheduled_start timestamptz,add column scheduled_end timestamptz;
update public.task_special_activations a set scheduled_start=e.start_date::timestamp at time zone 'Asia/Kolkata',scheduled_end=public.task_app_special_end(e)from public.task_special_meetings e where e.id=a.meeting_id and e.owner_id=a.owner_id;
alter table public.task_special_activations alter column scheduled_start set not null,alter column scheduled_end set not null,
 add constraint special_activation_schedule check(scheduled_start<scheduled_end);
create function public.task_app_special_activation_schedule()returns trigger language plpgsql security definer set search_path=''as $$
begin
 select e.start_date::timestamp at time zone 'Asia/Kolkata',public.task_app_special_end(e)into new.scheduled_start,new.scheduled_end from public.task_special_meetings e where e.id=new.meeting_id and e.owner_id=new.owner_id;
 return new;
end;$$;
revoke all on function public.task_app_special_activation_schedule()from public,anon,authenticated,service_role;
create trigger special_activation_schedule before insert on public.task_special_activations for each row execute function public.task_app_special_activation_schedule();
do $$declare body text;needle text;replacement text;begin
 body:=pg_get_functiondef('public.task_app_special_replaced(uuid,text,date,timestamptz)'::regprocedure);
 needle:='greatest(a.opened_at,e.start_date::timestamp at time zone ''Asia/Kolkata'',begins)<least(coalesce(a.closed_at,''infinity''::timestamptz),public.task_app_special_end(e),ends_at,at_time)';
 replacement:='greatest(a.opened_at,a.scheduled_start,begins)<least(coalesce(a.closed_at,''infinity''::timestamptz),a.scheduled_end,ends_at,at_time)';
 if strpos(body,needle)=0 then raise exception 'Unexpected036 replacement definition';end if;
 execute replace(body,needle,replacement);
end;$$;
-- Deferral permits a one-day shift when several adjacent daily rows already
-- exist. The same per-plan/date uniqueness is enforced before returning.
drop index public.special_daily_occurrence;
alter table public.tasks add constraint special_daily_occurrence unique(special_plan_id,due_date)deferrable initially immediate;
create function public.task_app_reschedule_special_task(task_id uuid,expected_version timestamptz,operation text,fields jsonb,new_status text,edit_scope text,expected_series_version timestamptz,meeting_date date,meeting_version timestamptz,confirmed boolean default false,assignment_future boolean default false)
returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;t public.tasks;p public.task_special_plans;e public.task_special_meetings;r jsonb;delta integer;at_time timestamptz;
begin
 m:=public.task_app_require_role(true);
 if operation is distinct from 'update'or confirmed is distinct from true or meeting_date is null or meeting_date not between date '0001-01-01'and date '9999-11-30'or meeting_version is null or not isfinite(meeting_version)or expected_version is null or not isfinite(expected_version)then raise exception 'Confirm the new Special Meeting date'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('special:'||m.owner_id::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null for update;
 if t.id is null then return null;end if;
 if t.updated_at is distinct from expected_version then return jsonb_build_object('conflict',true);end if;
 select * into p from public.task_special_plans where id=t.special_plan_id and owner_id=m.owner_id for update;
 select * into e from public.task_special_meetings where id=p.meeting_id and owner_id=m.owner_id for update;
 if e.id is null then raise exception 'Choose a saved Special Meeting task'using errcode='23514';end if;
 if e.updated_at is distinct from meeting_version then return jsonb_build_object('conflict',true,'series_version',p.updated_at);end if;
 delta:=meeting_date-e.start_date;
 if delta=0 then return public.task_app_mutate_special(task_id,expected_version,operation,fields,new_status,edit_scope,expected_series_version,assignment_future);end if;
 at_time:=clock_timestamp();
 if (meeting_date+coalesce(e.duration_days,2))::timestamp at time zone 'Asia/Kolkata'<=at_time then raise exception 'Choose dates whose meeting deadline has not passed'using errcode='P0409';end if;
 if exists(select 1 from public.task_special_meetings other where other.owner_id=m.owner_id and other.id<>e.id and other.start_date=meeting_date and other.duration_days is not distinct from e.duration_days)then raise exception 'A Special Meeting already uses these dates. Choose another date.'using errcode='P0409';end if;
 -- Reuse all existing field, permission, status and future-assignment guards.
 -- Fields still carry this occurrence's saved due date; the shared move follows.
 r:=public.task_app_mutate_special(task_id,expected_version,operation,fields,new_status,edit_scope,expected_series_version,assignment_future);
 if r is null or coalesce((r->>'conflict')::boolean,false)then return r;end if;
 update public.task_special_activations set closed_at=at_time where meeting_id=e.id and owner_id=m.owner_id and closed_at is null;
 update public.task_special_meetings set start_date=meeting_date,locked=true,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')where id=e.id;
 update public.task_special_plans plan set
  payload=jsonb_set(payload,'{due_date}',to_jsonb(coalesce((payload->>'due_date')::date,e.start_date)+delta)),
  released_dates=array(select d+delta from unnest(plan.released_dates)d),
  updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')where meeting_id=e.id and owner_id=m.owner_id;
 set constraints public.special_daily_occurrence deferred;
 update public.tasks saved set due_date=coalesce(saved.due_date,e.start_date)+delta
 from public.task_special_plans plan where saved.special_plan_id=plan.id and plan.meeting_id=e.id and saved.owner_id=m.owner_id;
 set constraints public.special_daily_occurrence immediate;
 select to_jsonb(saved)||jsonb_build_object('series_version',plan.updated_at)into r from public.tasks saved join public.task_special_plans plan on plan.id=saved.special_plan_id where saved.id=task_id and saved.owner_id=m.owner_id;
 return r;
end;$$;
revoke all on function public.task_app_reschedule_special_task(uuid,timestamptz,text,jsonb,text,text,timestamptz,date,timestamptz,boolean,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_reschedule_special_task(uuid,timestamptz,text,jsonb,text,text,timestamptz,date,timestamptz,boolean,boolean)to authenticated;
notify pgrst,'reload schema';
commit;
