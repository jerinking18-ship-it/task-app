-- Local until publication approval. Additive transition guard: no row rewrites or new client privileges.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.task_app_has_completion_check_in(public.tasks,uuid,timestamp with time zone)')is not null then
  raise exception '043 already installed; never replay';end if;
 if to_regclass('public.task_member_check_ins')is null
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.task_app_valid_template_items(jsonb)')and prosrc like '%assignedToId%')then
  raise exception 'Install reviewed001–042 first';end if;
end;$$;
lock table public.tasks in share row exclusive mode;

create function public.task_app_has_completion_check_in(t public.tasks,actor_id uuid,at_time timestamptz)
returns boolean language plpgsql stable security definer set search_path=''as $$
declare category_name text;meeting_day date;meeting uuid;service_name text:='';weekday integer;distance integer;
 e public.task_special_meetings;actor_task public.tasks;
begin
 if actor_id is null or at_time is null or not isfinite(at_time)then return false;end if;
 if not exists(select 1 from public.account_members m where m.id=actor_id and m.owner_id=t.owner_id and m.left_at is null and m.auth_user_id is not null)then return false;end if;
 select c.name into category_name from public.categories c where c.id=t.category_id and c.owner_id=t.owner_id;
 if category_name='Special Meeting'then
  select m.* into e from public.task_special_plans p join public.task_special_meetings m on m.id=p.meeting_id and m.owner_id=p.owner_id
   where p.id=t.special_plan_id and p.owner_id=t.owner_id;
  if e.id is null then return false;end if;
  meeting:=e.id;meeting_day:=case when e.duration_days is null then e.start_date else t.due_date end;
  if meeting_day is null or meeting_day<e.start_date or meeting_day>=e.start_date+coalesce(e.duration_days,1)then return false;end if;
 elsif category_name in('Sunday Service','Healing Meeting','Revival Meeting')then
  if category_name='Sunday Service'then service_name:=coalesce(t.sunday_service,'evening');end if;
  if t.due_date is null then
   select c.meeting_date into meeting_day from public.task_app_check_in_contexts(t.owner_id,at_time)c
    where c.category_id=t.category_id and c.service=service_name and c.meeting_id is null;
  else
   weekday:=case category_name when 'Sunday Service'then 0 when 'Healing Meeting'then 3 else 5 end;
   distance:=(extract(dow from t.due_date)::integer-weekday+7)%7;
   -- Both regular meeting days share one check-in; unrelated weekdays do not invent a scope.
   if distance>1 then return false;end if;
   meeting_day:=t.due_date-distance;
  end if;
 else return false;
 end if;
 if meeting_day is null then return false;end if;
 if not exists(select 1 from public.task_member_check_ins i where i.owner_id=t.owner_id and i.member_id=actor_id
  and i.category_id=t.category_id and i.meeting_date=meeting_day and i.service=service_name
  and i.meeting_id is not distinct from meeting and i.checked_at<=at_time)then return false;end if;
 -- A subsequent self-marked absence requires returning through Check In again.
 -- Manager restrictions keep their independent authorization and removal rules.
 actor_task:=t;actor_task.assigned_to_member_id:=actor_id;actor_task.status:='active';
 return not exists(select 1 from public.account_member_absences a where a.cancelled_at is null
  and public.task_app_absence_covers(actor_task,a,at_time));
end;$$;
revoke all on function public.task_app_has_completion_check_in(public.tasks,uuid,timestamptz)from public,anon,authenticated,service_role;

create function public.task_app_guard_completion_check_in()returns trigger language plpgsql security definer set search_path=''as $$
declare actor public.account_members;
begin
 -- Restoring or editing an existing completion and reopening do not create a new completion.
 if new.status='completed'and old.status is distinct from 'completed'then
  actor:=public.task_app_current_member();
  if actor.id is null or actor.owner_id is distinct from new.owner_id
   or not public.task_app_has_completion_check_in(new,actor.id,clock_timestamp())then
   raise exception 'Check in for this task meeting date and service before completing it'using errcode='P0043';
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.task_app_guard_completion_check_in()from public,anon,authenticated,service_role;
-- Runs after the existing meeting-start guard, before completion attribution and counters.
create trigger tasks_ab_completion_check_in before update on public.tasks for each row execute function public.task_app_guard_completion_check_in();
commit;
