-- Additive status-transition guard. No historical rows, grants or jobs change.
begin;
do $$begin
 if to_regprocedure('public.task_app_reschedule_special_task(uuid,timestamp with time zone,text,jsonb,text,text,timestamp with time zone,date,timestamp with time zone,boolean,boolean)')is null
 or not exists(select 1 from information_schema.columns where table_schema='public'and table_name='task_special_activations'and column_name='scheduled_start')then
  raise exception 'Install the reviewed037 baseline first';end if;
 if to_regprocedure('public.task_app_completion_open(public.tasks,timestamp with time zone)')is not null then raise exception '038 is already installed; do not replay';end if;
end;$$;
lock table public.tasks in share row exclusive mode;

create function public.task_app_completion_open(t public.tasks,at_time timestamptz)
returns boolean language plpgsql stable security definer set search_path=''as $$
declare category_name text;weekday integer;distance integer;meeting_day date;today date;e public.task_special_meetings;
begin
 if at_time is null or not isfinite(at_time)then return false;end if;
 select c.name into category_name from public.categories c where c.id=t.category_id and c.owner_id=t.owner_id;
 if category_name is null or category_name not in('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting')then return true;end if;
 if t.available_at is not null and t.available_at>at_time then return false;end if;
 today:=(at_time at time zone 'Asia/Kolkata')::date;
 if category_name='Special Meeting'then
  if t.special_plan_id is not null then
   select m.* into e from public.task_special_plans p join public.task_special_meetings m on m.id=p.meeting_id and m.owner_id=p.owner_id where p.id=t.special_plan_id and p.owner_id=t.owner_id;
   return coalesce(e.id is not null and not e.locked and t.special_enabled and at_time>=e.start_date::timestamp at time zone 'Asia/Kolkata'
    and at_time<public.task_app_special_end(e)and at_time>=coalesce(t.due_date,e.start_date)::timestamp at time zone 'Asia/Kolkata',false);
  end if;
  if t.due_date is not null then return at_time>=t.due_date::timestamp at time zone 'Asia/Kolkata'and at_time<(t.due_date+2)::timestamp at time zone 'Asia/Kolkata';end if;
  if cardinality(t.weekdays)>0 then return extract(dow from today)::integer=any(t.weekdays)or extract(dow from today-1)::integer=any(t.weekdays);end if;
  return t.created_at is not null and at_time>=t.created_at and at_time<(((t.created_at at time zone 'Asia/Kolkata')::date+2)::timestamp at time zone 'Asia/Kolkata');
 end if;
 weekday:=case category_name when 'Sunday Service'then 0 when 'Healing Meeting'then 3 else 5 end;
 if t.due_date is null then return extract(dow from today)::integer in(weekday,weekday+1);end if;
 distance:=(extract(dow from t.due_date)::integer-weekday+7)%7;
 meeting_day:=t.due_date-case when distance<=1 then distance else 0 end;
 return at_time>=meeting_day::timestamp at time zone 'Asia/Kolkata';
end;$$;
revoke all on function public.task_app_completion_open(public.tasks,timestamptz)from public,anon,authenticated,service_role;

create function public.task_app_guard_completion_start()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.status='completed'and(tg_op='INSERT'or old.status is distinct from 'completed')then
  if not public.task_app_completion_open(new,clock_timestamp())then
   raise exception 'Task is locked until its meeting starts; Special Meeting also requires activation'using errcode='P0038';end if;
 end if;
 return new;
end;$$;
revoke all on function public.task_app_guard_completion_start()from public,anon,authenticated,service_role;
create trigger tasks_aa_meeting_completion_start before insert or update on public.tasks for each row execute function public.task_app_guard_completion_start();
commit;
