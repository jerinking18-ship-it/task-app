-- Local until publication approval. Validate new/changed schedules; never rewrite saved work.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.task_app_regular_schedule_valid(text,date,text,smallint[])')is not null then
  raise exception '044 already installed; never replay';end if;
 if to_regprocedure('public.task_app_guard_completion_check_in()')is null then
  raise exception 'Install reviewed001–043 first';end if;
end;$$;
lock table public.tasks,public.task_repeat_pending in share row exclusive mode;

create function public.task_app_regular_schedule_valid(category_name text,day date,rule text,days smallint[])
returns boolean language plpgsql immutable security invoker set search_path=''as $$
declare first_day integer;allowed smallint[];
begin
 first_day:=case category_name when 'Sunday Service'then 0 when 'Healing Meeting'then 3 when 'Revival Meeting'then 5 end;
 if first_day is null then return true;end if;
 allowed:=array[first_day::smallint,((first_day+1)%7)::smallint];
 if day is not null and(not isfinite(day)or day<date '0001-01-01'or day>date '9999-12-31')then return false;end if;
 return coalesce((day is null or extract(dow from day)::smallint=any(allowed))
  and rule in('off','weekly')
  and(rule<>'weekly'or(day is not null and cardinality(days)>0 and days<@allowed and extract(dow from day)::smallint=any(days))),false);
end;$$;
revoke all on function public.task_app_regular_schedule_valid(text,date,text,smallint[])from public,anon,authenticated,service_role;

create function public.task_app_guard_regular_schedule()returns trigger language plpgsql security definer set search_path=''as $$
declare category_name text;
begin
 if tg_op='UPDATE'then
  if new.category_id is not distinct from old.category_id and new.due_date is not distinct from old.due_date
   and new.weekdays is not distinct from old.weekdays and(new.repeat_rule is not distinct from old.repeat_rule or new.repeat_rule='off')then return new;end if;
  -- Bin's private restore implementation resumes saved repeat metadata in a
  -- fresh child series. Clients cannot supply this server-owned series link.
  if old.repeat_rule='off'and old.series_id is not null and new.series_id is distinct from old.series_id
   and new.category_id is not distinct from old.category_id and new.due_date is not distinct from old.due_date
   and new.weekdays is not distinct from old.weekdays
   and exists(select 1 from public.task_series s where s.id=new.series_id and s.owner_id=new.owner_id and s.bin_restarted_from is not null)then return new;end if;
 end if;
 select c.name into category_name from public.categories c where c.id=new.category_id and c.owner_id=new.owner_id;
 if public.task_app_regular_schedule_valid(category_name,new.due_date,new.repeat_rule,new.weekdays)then return new;end if;
 -- A previously saved legacy repeat may still release its reserved occurrence.
 -- Clients cannot create queue rows or choose an id/series/occurrence in task RPCs.
 -- Keeping these schedules does not let a new or edited schedule bypass validation.
 if tg_op='INSERT'and exists(select 1 from public.task_repeat_pending p join public.tasks source
   on source.id=p.source_task_id and source.owner_id=p.owner_id
   join public.categories c on c.id=source.category_id and c.owner_id=source.owner_id
   where p.id=new.id and p.owner_id=new.owner_id and p.series_id=new.series_id and p.occurrence_number=new.occurrence_number
    and p.generated_at is null and not p.cancelled and p.due_date=new.due_date
    and(p.payload->>'category_id')::uuid=new.category_id and p.payload->>'repeat_rule'=new.repeat_rule
    and array(select jsonb_array_elements_text(p.payload->'weekdays')::smallint)=new.weekdays
    and not public.task_app_regular_schedule_valid(c.name,source.due_date,source.repeat_rule,source.weekdays))then return new;end if;
 raise exception 'Use this meeting allowed dates and Off or Weekly repeat days'using errcode='P0044';
end;$$;
revoke all on function public.task_app_guard_regular_schedule()from public,anon,authenticated,service_role;
create trigger tasks_ac_regular_schedule before insert or update on public.tasks for each row execute function public.task_app_guard_regular_schedule();

create function public.task_app_guard_regular_pending()returns trigger language plpgsql security definer set search_path=''as $$
declare category_name text;source public.tasks;days smallint[];
begin
 if tg_op='UPDATE'and new.due_date is not distinct from old.due_date
  and new.payload->'category_id'is not distinct from old.payload->'category_id'
  and new.payload->'repeat_rule'is not distinct from old.payload->'repeat_rule'
  and new.payload->'weekdays'is not distinct from old.payload->'weekdays'then return new;end if;
 select c.name into category_name from public.categories c where c.id=(new.payload->>'category_id')::uuid and c.owner_id=new.owner_id;
 days:=array(select jsonb_array_elements_text(new.payload->'weekdays')::smallint);
 if public.task_app_regular_schedule_valid(category_name,new.due_date,new.payload->>'repeat_rule',days)then return new;end if;
 -- Preserve successors from unchanged pre-existing legacy schedules only.
 if tg_op='INSERT'then
  select t.* into source from public.tasks t where t.id=new.source_task_id and t.owner_id=new.owner_id and t.series_id=new.series_id;
  if source.id is not null and source.category_id=(new.payload->>'category_id')::uuid and source.repeat_rule=new.payload->>'repeat_rule'
   and source.weekdays=days and not public.task_app_regular_schedule_valid(category_name,source.due_date,source.repeat_rule,source.weekdays)then return new;end if;
 end if;
 raise exception 'Use this meeting allowed dates and Off or Weekly repeat days'using errcode='P0044';
end;$$;
revoke all on function public.task_app_guard_regular_pending()from public,anon,authenticated,service_role;
create trigger task_repeat_pending_regular_schedule before insert or update on public.task_repeat_pending for each row execute function public.task_app_guard_regular_pending();
commit;
