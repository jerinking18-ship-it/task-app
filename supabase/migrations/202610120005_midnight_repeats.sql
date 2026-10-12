-- LOCAL REVIEW ONLY. Does not install/activate a scheduler or run maintenance.
begin;

-- Existing generated successors keep their IDs, content and edit history. Only
-- future active heads linked from a predecessor wait until their scheduled day.
alter table public.tasks add column available_at timestamptz;
update public.tasks as next set available_at=next.due_date::timestamp at time zone 'Asia/Kolkata'
where next.status='active' and next.repeat_rule<>'off' and next.deleted_at is null
  and next.next_occurrence_id is null
  and next.due_date>(statement_timestamp() at time zone 'Asia/Kolkata')::date
  and exists(select 1 from public.tasks previous where previous.next_occurrence_id=next.id
    and previous.owner_id=next.owner_id);
update public.tasks as previous set history_at=next.due_date::timestamp at time zone 'Asia/Kolkata'
from public.tasks next where previous.next_occurrence_id=next.id
  and previous.owner_id=next.owner_id and previous.history_at>statement_timestamp();

-- A pending schedule is not a task. The reserved ID makes reopening/recompletion
-- idempotent. Snapshot details survive "this task only" edits and soft deletion.
create table public.task_repeat_pending (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_task_id uuid not null unique references public.tasks(id) on delete cascade,
  series_id uuid not null,
  occurrence_number integer not null check(occurrence_number>0),
  due_date date not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  cancelled boolean not null default false,
  generated_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key(owner_id,series_id) references public.task_series(owner_id,id) on delete restrict,
  unique(series_id,occurrence_number)
);
create index task_repeat_pending_due_idx on public.task_repeat_pending(due_date,series_id)
  where generated_at is null and not cancelled;
alter table public.task_repeat_pending enable row level security;
-- Internal queue: no browser/API role can read or write it directly.
revoke all on public.task_repeat_pending from public,anon,authenticated,service_role;

-- Availability is now a calendar-day boundary, independent of the deadline.
-- A late completion after today's midnight skips today even if its task time
-- has not passed. Keep the signature for existing callers and monthly anchors.
create or replace function public.task_app_next_date(rule text, current_date_value date,
  current_time_value time, days smallint[], anchor smallint, completed_when timestamptz)
returns date language plpgsql immutable security invoker set search_path='' as $$
declare cutoff date:=greatest(current_date_value,(completed_when at time zone 'Asia/Kolkata')::date);
  candidate date; month_start date;
begin
  if rule='daily' then candidate:=cutoff+1;
  elsif rule='weekly' then
    if cardinality(days)=0 then raise exception 'Choose repeat days' using errcode='23514'; end if;
    candidate:=cutoff+1;
    while not(extract(dow from candidate)::smallint=any(days)) loop candidate:=candidate+1; end loop;
  elsif rule='monthly' then
    if anchor is null or anchor not between 1 and 31 then
      raise exception 'Monthly anchor required' using errcode='23514'; end if;
    month_start:=greatest((date_trunc('month',current_date_value)+interval '1 month')::date,
      date_trunc('month',cutoff)::date);
    loop
      candidate:=month_start+least(anchor,extract(day from month_start+interval '1 month - 1 day')::integer)-1;
      exit when candidate>cutoff;
      month_start:=(month_start+interval '1 month')::date;
    end loop;
  else raise exception 'Unknown repeat rule' using errcode='23514'; end if;
  if candidate>date '9999-12-31' then raise exception 'Date exceeds supported range' using errcode='23514'; end if;
  return candidate;
end;
$$;

create or replace function public.task_app_spawn_next()
returns trigger language plpgsql security definer set search_path='' as $$
declare next_date_value date; next_id uuid;
begin
  if new.status='completed' and old.status='active' and new.repeat_rule<>'off'
    and new.next_occurrence_id is null and new.deleted_at is null then
    next_date_value:=public.task_app_next_date(new.repeat_rule,new.due_date,new.due_time,
      new.weekdays,new.repeat_anchor_day,statement_timestamp());
    next_id:=gen_random_uuid();
    insert into public.task_repeat_pending(id,owner_id,source_task_id,series_id,occurrence_number,due_date,payload)
    values(next_id,new.owner_id,new.id,new.series_id,new.occurrence_number+1,next_date_value,
      jsonb_build_object('title',new.title,'notes',new.notes,'due_time',new.due_time,
        'priority',new.priority,'category_id',new.category_id,'weekdays',to_jsonb(new.weekdays),
        'repeat_rule',new.repeat_rule,'repeat_anchor_day',new.repeat_anchor_day));
    update public.tasks set next_occurrence_id=next_id where id=new.id and owner_id=new.owner_id;
  end if;
  return null;
end;
$$;

-- Internal clock-injected worker is administrator-only. Public entry points use
-- the server clock. Series locks use the same order as user mutations; a busy
-- series is retried on the next scheduled run/read instead of blocking others.
create function public.task_app_release_repeats(owner_scope uuid, release_when timestamptz)
returns bigint language plpgsql security definer set search_path='' as $$
declare candidate record; pending public.task_repeat_pending; released bigint:=0;
  today date:=(release_when at time zone 'Asia/Kolkata')::date;
begin
  if release_when is null then raise exception 'Server time required' using errcode='23514'; end if;
  for candidate in select id,series_id from public.task_repeat_pending
    where generated_at is null and not cancelled and due_date<=today
      and (owner_scope is null or owner_id=owner_scope) order by series_id,id loop
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.series_id::text,0)) then continue; end if;
    select * into pending from public.task_repeat_pending where id=candidate.id
      and generated_at is null and not cancelled and due_date<=today
      and (owner_scope is null or owner_id=owner_scope) for update;
    if not found then continue; end if;
    -- Insert and History transition are atomic. A failed insert leaves the queue
    -- intact. Delayed scheduler recovery creates just this one waiting occurrence.
    insert into public.tasks(id,owner_id,title,notes,status,due_date,due_time,priority,
      category_id,weekdays,repeat_rule,repeat_anchor_day,series_id,occurrence_number,available_at)
    values(pending.id,pending.owner_id,pending.payload->>'title',pending.payload->>'notes','active',
      pending.due_date,(pending.payload->>'due_time')::time,pending.payload->>'priority',
      (pending.payload->>'category_id')::uuid,
      array(select jsonb_array_elements_text(pending.payload->'weekdays')::smallint),
      pending.payload->>'repeat_rule',(pending.payload->>'repeat_anchor_day')::smallint,
      pending.series_id,pending.occurrence_number,pending.due_date::timestamp at time zone 'Asia/Kolkata');
    update public.tasks set history_at=greatest(release_when,pending.due_date::timestamp at time zone 'Asia/Kolkata')
      where id=pending.source_task_id and owner_id=pending.owner_id;
    update public.task_repeat_pending set generated_at=release_when,updated_at=statement_timestamp()
      where id=pending.id;
    released:=released+1;
  end loop;
  return released;
end;
$$;

create function public.task_app_release_my_repeats()
returns bigint language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid();
begin
  if own_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return public.task_app_release_repeats(own_id,statement_timestamp());
end;
$$;
create function public.task_app_release_scheduled_repeats()
returns bigint language sql security definer set search_path='' as $$
  select public.task_app_release_repeats(null,statement_timestamp());
$$;

-- Keep the reviewed mutation implementation (validation, ownership, row/series
-- conflicts and actual occurrence editing) private, with pending-schedule support
-- in the public wrapper. Clients cannot bypass the wrapper.
alter function public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)
  rename to task_app_mutate_task;
revoke all on function public.task_app_mutate_task(uuid,timestamptz,text,jsonb,text,text,timestamptz)
  from public,anon,authenticated,service_role;

create function public.task_app_mutate(task_id uuid, expected_version timestamptz,
  operation text, fields jsonb default null, new_status text default null,
  edit_scope text default 'this', expected_series_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.tasks; result jsonb; pending public.task_repeat_pending;
  own_id uuid:=auth.uid(); schedule_changed boolean; cursor_date date; anchor smallint;
  position integer; version timestamptz; pending_details jsonb;
begin
  if own_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select * into target from public.tasks where id=task_id and owner_id=own_id and deleted_at is null;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(target.series_id,target.id)::text,0));
  result:=public.task_app_mutate_task(task_id,expected_version,operation,fields,new_status,
    edit_scope,expected_series_version);
  if result is null then return null; end if;
  if result->>'conflict'='true' then
    -- Pending schedules take part in the same review flow as actual future tasks.
    select coalesce(jsonb_agg(p.payload||jsonb_build_object('id',p.id,'due_date',p.due_date,
      'status','active','completed_at',null,'series_id',p.series_id,'history_at',null,
      'available_at',p.due_date::timestamp at time zone 'Asia/Kolkata',
      'created_at',p.created_at,'updated_at',p.updated_at)),'[]'::jsonb)
      into pending_details from public.task_repeat_pending p where p.owner_id=own_id
        and p.series_id=target.series_id and p.occurrence_number>target.occurrence_number
        and p.generated_at is null and not p.cancelled;
    return result||jsonb_build_object('future',coalesce(result->'future','[]'::jsonb)||pending_details);
  end if;
  if operation='update' then
    if edit_scope='future' and target.series_id is not null then
      anchor:=case when fields->>'repeat_rule'='monthly' then
        case when target.repeat_rule='monthly' and target.due_date=(fields->>'due_date')::date
          then target.repeat_anchor_day else extract(day from (fields->>'due_date')::date)::smallint end else null end;
      schedule_changed:=target.repeat_rule is distinct from fields->>'repeat_rule'
        or target.due_date is distinct from (fields->>'due_date')::date
        or target.due_time is distinct from (fields->>'due_time')::time
        or target.weekdays is distinct from array(select jsonb_array_elements_text(fields->'weekdays')::smallint);
      for pending in select * from public.task_repeat_pending where owner_id=own_id
        and series_id=target.series_id and occurrence_number>target.occurrence_number
        and generated_at is null order by occurrence_number for update loop
        cursor_date:=pending.due_date;
        if coalesce(fields->>'repeat_rule','off')<>'off' and (schedule_changed or pending.cancelled) then
          cursor_date:=(fields->>'due_date')::date;
          for position in target.occurrence_number+1..pending.occurrence_number loop
            cursor_date:=public.task_app_next_date(fields->>'repeat_rule',cursor_date,(fields->>'due_time')::time,
              array(select jsonb_array_elements_text(fields->'weekdays')::smallint),anchor,
              case when position=pending.occurrence_number then statement_timestamp() else '-infinity'::timestamptz end);
          end loop;
        end if;
        update public.task_repeat_pending set due_date=cursor_date,
          cancelled=coalesce(fields->>'repeat_rule','off')='off',updated_at=statement_timestamp(),
          payload=jsonb_build_object('title',fields->>'title','notes',fields->>'notes',
            'due_time',fields->>'due_time','priority',fields->>'priority','category_id',fields->>'category_id',
            'weekdays',fields->'weekdays','repeat_rule',coalesce(fields->>'repeat_rule','off'),'repeat_anchor_day',anchor)
          where id=pending.id;
      end loop;
    end if;
    -- Follow rescheduling of an existing delayed successor. Never delay an
    -- occurrence that has already become available or rewrite archived history.
    update public.tasks set available_at=due_date::timestamp at time zone 'Asia/Kolkata'
      where owner_id=own_id and available_at>statement_timestamp()
        and (id=target.id or (edit_scope='future' and series_id=target.series_id));
    update public.tasks previous set history_at=next.due_date::timestamp at time zone 'Asia/Kolkata'
      from public.tasks next where previous.owner_id=own_id and next.owner_id=own_id
        and previous.next_occurrence_id=next.id and previous.history_at>statement_timestamp()
        and (next.id=target.id or (edit_scope='future' and next.series_id=target.series_id));
  end if;
  select * into target from public.tasks where id=task_id and owner_id=own_id;
  select max(updated_at) into version from public.tasks where owner_id=own_id
    and (series_id=target.series_id or id=target.id) and deleted_at is null;
  return to_jsonb(target)||jsonb_build_object('series_version',version);
end;
$$;

revoke all on function public.task_app_release_repeats(uuid,timestamptz),
  public.task_app_release_my_repeats(),public.task_app_release_scheduled_repeats(),
  public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.task_app_release_my_repeats(),
  public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
