-- LOCAL REVIEW ONLY. Schema and functions; does not schedule or run cleanup.
begin;

create table public.task_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique(owner_id,id)
);
alter table public.task_series enable row level security;
revoke all on public.task_series from public, anon, authenticated;
grant select on public.task_series to authenticated;
create policy task_series_select_own on public.task_series for select to authenticated
  using ((select auth.uid()) = owner_id);

alter table public.tasks
  add column repeat_rule text not null default 'off',
  add column repeat_anchor_day smallint,
  add column series_id uuid,
  add column occurrence_number integer not null default 0,
  add column next_occurrence_id uuid,
  add column history_at timestamptz,
  add constraint tasks_repeat_rule_valid check (repeat_rule in ('off','daily','weekly','monthly')),
  add constraint tasks_repeat_date_required check (repeat_rule = 'off' or due_date is not null),
  add constraint tasks_repeat_weekly_valid check (repeat_rule <> 'weekly' or
    (cardinality(weekdays)>0 and extract(dow from due_date)::smallint = any(weekdays))),
  add constraint tasks_repeat_monthly_valid check (
    (repeat_rule='monthly' and repeat_anchor_day between 1 and 31) or
    (repeat_rule<>'monthly' and repeat_anchor_day is null)),
  add constraint tasks_repeat_series_required check (repeat_rule='off' or series_id is not null),
  add constraint tasks_owned_series_fkey foreign key(owner_id,series_id)
    references public.task_series(owner_id,id) on delete restrict,
  add constraint tasks_history_requires_successor check (history_at is null or next_occurrence_id is not null),
  add constraint tasks_occurrence_valid check (occurrence_number>=0),
  add constraint tasks_series_occurrence_unique unique(series_id,occurrence_number);
create index tasks_series_idx on public.tasks(owner_id,series_id);
create index tasks_history_retention_idx on public.tasks(history_at) where status='completed';

-- Pure calendar calculation. Timestamp comparison uses the account's India time.
-- Never backfills missed occurrences. Monthly retains the original day anchor.
create function public.task_app_next_date(rule text, current_date_value date,
  current_time_value time, days smallint[], anchor smallint, completed_when timestamptz)
returns date language plpgsql immutable security invoker set search_path='' as $$
declare
  cutoff timestamp := greatest(current_date_value + coalesce(current_time_value,time '00:00'),
    completed_when at time zone 'Asia/Kolkata');
  candidate date;
  month_start date;
begin
  if rule='daily' then
    candidate := greatest(current_date_value+1,cutoff::date);
    if candidate+coalesce(current_time_value,time '00:00')<=cutoff then candidate:=candidate+1; end if;
  elsif rule='weekly' then
    if cardinality(days)=0 then raise exception 'Choose repeat days' using errcode='23514'; end if;
    candidate := greatest(current_date_value+1,cutoff::date);
    while not (extract(dow from candidate)::smallint=any(days)) or
      candidate+coalesce(current_time_value,time '00:00')<=cutoff loop
      candidate:=candidate+1;
    end loop;
  elsif rule='monthly' then
    if anchor is null or anchor not between 1 and 31 then
      raise exception 'Monthly anchor required' using errcode='23514';
    end if;
    month_start:=greatest((date_trunc('month',current_date_value)+interval '1 month')::date,
      date_trunc('month',cutoff)::date);
    loop
      candidate:=month_start + least(anchor,extract(day from month_start+interval '1 month - 1 day')::integer)-1;
      exit when candidate+coalesce(current_time_value,time '00:00')>cutoff;
      month_start:=(month_start+interval '1 month')::date;
    end loop;
  else
    raise exception 'Unknown repeat rule' using errcode='23514';
  end if;
  if candidate > date '9999-12-31' then raise exception 'Date exceeds supported range' using errcode='23514'; end if;
  return candidate;
end;
$$;

-- Server-owned recurrence metadata cannot be supplied through client grants.
create function public.task_app_prepare_repeat()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' and new.repeat_rule<>'off' and new.status<>'active' then
    raise exception 'New repeating tasks start active' using errcode='23514';
  end if;
  if new.repeat_rule<>'off' and new.series_id is null then
    insert into public.task_series(owner_id) values(new.owner_id) returning id into new.series_id;
  end if;
  if new.repeat_rule='monthly' then
    if new.repeat_anchor_day is null then new.repeat_anchor_day:=extract(day from new.due_date); end if;
  else new.repeat_anchor_day:=null;
  end if;
  return new;
end;
$$;
create trigger tasks_prepare_repeat before insert or update on public.tasks
  for each row execute function public.task_app_prepare_repeat();

-- One completion and its successor are a single transaction. The row lock and
-- persistent successor ID prevent duplicates, including reopening/recompletion.
create function public.task_app_spawn_next()
returns trigger language plpgsql security definer set search_path='' as $$
declare next_date_value date; next_id uuid; due_at timestamptz;
begin
  if new.status='completed' and old.status='active' and new.repeat_rule<>'off'
    and new.next_occurrence_id is null and new.deleted_at is null then
    next_date_value:=public.task_app_next_date(new.repeat_rule,new.due_date,new.due_time,
      new.weekdays,new.repeat_anchor_day,statement_timestamp());
    next_id:=gen_random_uuid();
    insert into public.tasks(id,owner_id,title,notes,status,due_date,due_time,priority,
      category_id,weekdays,repeat_rule,repeat_anchor_day,series_id,occurrence_number)
    values(next_id,new.owner_id,new.title,new.notes,'active',next_date_value,new.due_time,new.priority,
      new.category_id,new.weekdays,new.repeat_rule,new.repeat_anchor_day,new.series_id,new.occurrence_number+1);
    due_at:=(next_date_value+coalesce(new.due_time,time '00:00')) at time zone 'Asia/Kolkata';
    update public.tasks set next_occurrence_id=next_id,history_at=due_at where id=new.id and owner_id=new.owner_id;
  end if;
  return null;
end;
$$;
create trigger tasks_spawn_next after update on public.tasks
  for each row execute function public.task_app_spawn_next();

-- Mutations use one owner-checked RPC. Series locks serialize completion and
-- future edits. All client UPDATE grants are revoked below; metadata stays private.
create function public.task_app_mutate(task_id uuid, expected_version timestamptz,
  operation text, fields jsonb default null, new_status text default null,
  edit_scope text default 'this', expected_series_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.tasks; current_task public.tasks; own_id uuid:=auth.uid();
  chosen_series uuid; anchor smallint; series_version timestamptz;
  conflict_details jsonb; schedule_changed boolean; schedule_cursor date;
begin
  if own_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if task_id is null or expected_version is null then
    raise exception 'Task and version required' using errcode='23514'; end if;
  if operation is null or edit_scope is null or operation not in ('update','status','delete') or edit_scope not in ('this','future') then
    raise exception 'Invalid operation' using errcode='23514';
  end if;
  select * into target from public.tasks where id=task_id and owner_id=own_id and deleted_at is null;
  if not found then return null; end if;
  -- Also serialize enabling repeat on a formerly ordinary task.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(target.series_id,target.id)::text,0));
  select * into target from public.tasks where id=task_id and owner_id=own_id and deleted_at is null for update;
  if not found then return null; end if;
  select max(updated_at) into series_version from public.tasks where owner_id=own_id
    and (series_id=target.series_id or id=target.id) and deleted_at is null;
  select jsonb_build_object('conflict',true,'series_version',series_version,'future',coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb))
    into conflict_details from public.tasks t where owner_id=own_id and series_id=target.series_id
    and occurrence_number>target.occurrence_number and status='active' and deleted_at is null;
  if target.updated_at<>expected_version then return conflict_details; end if;
  if edit_scope='future' and target.series_id is not null then
    perform 1 from public.tasks where owner_id=own_id and series_id=target.series_id order by id for update;
    if series_version is distinct from coalesce(expected_series_version,expected_version) then
      return conflict_details;
    end if;
  end if;
  if operation='delete' then
    update public.tasks set deleted_at=statement_timestamp() where id=target.id and owner_id=own_id;
  elsif operation='status' then
    if new_status not in ('active','completed') or new_status is null then
      raise exception 'Invalid status' using errcode='23514'; end if;
    update public.tasks set status=new_status where id=target.id and owner_id=own_id;
  else
    if fields is null or jsonb_typeof(fields)<>'object' or exists(
      select 1 from jsonb_object_keys(fields) as keys(key) where key not in
      ('title','notes','status','due_date','due_time','priority','category_id','weekdays','repeat_rule')) then
      raise exception 'Invalid fields' using errcode='23514'; end if;
    anchor:=case when fields->>'repeat_rule'='monthly' then
      case when target.repeat_rule='monthly' and target.due_date=(fields->>'due_date')::date
        then target.repeat_anchor_day else extract(day from (fields->>'due_date')::date)::smallint end else null end;
    update public.tasks set title=fields->>'title',notes=fields->>'notes',status=fields->>'status',
      due_date=(fields->>'due_date')::date,due_time=(fields->>'due_time')::time,
      priority=fields->>'priority',category_id=(fields->>'category_id')::uuid,
      weekdays=array(select jsonb_array_elements_text(fields->'weekdays')::smallint),
      repeat_rule=coalesce(fields->>'repeat_rule','off'),repeat_anchor_day=anchor
      where id=target.id and owner_id=own_id;
    if edit_scope='future' and target.series_id is not null then
      -- Advance the revised calendar in occurrence order, including completed
      -- positions without rewriting them. Reopened intermediate tasks must also
      -- receive a matching date when weekly days change. Only the pending head
      -- skips dates missed before now; existing successor links remain intact.
      select series_id into chosen_series from public.tasks where id=target.id and owner_id=own_id;
      schedule_cursor:=(fields->>'due_date')::date;
      schedule_changed:=target.repeat_rule is distinct from fields->>'repeat_rule'
        or target.due_date is distinct from schedule_cursor
        or target.due_time is distinct from (fields->>'due_time')::time
        or target.weekdays is distinct from array(select jsonb_array_elements_text(fields->'weekdays')::smallint);
      for current_task in select * from public.tasks where owner_id=own_id and series_id=chosen_series
        and occurrence_number>target.occurrence_number and deleted_at is null order by occurrence_number loop
        if schedule_changed and coalesce(fields->>'repeat_rule','off')<>'off' then
          schedule_cursor:=public.task_app_next_date(fields->>'repeat_rule',schedule_cursor,(fields->>'due_time')::time,
            array(select jsonb_array_elements_text(fields->'weekdays')::smallint),anchor,
            case when current_task.next_occurrence_id is null then statement_timestamp() else '-infinity'::timestamptz end);
        end if;
        if current_task.status<>'active' then continue; end if;
        update public.tasks set title=fields->>'title',notes=fields->>'notes',
          due_time=(fields->>'due_time')::time,priority=fields->>'priority',category_id=(fields->>'category_id')::uuid,
          weekdays=array(select jsonb_array_elements_text(fields->'weekdays')::smallint),
          repeat_rule=coalesce(fields->>'repeat_rule','off'),repeat_anchor_day=anchor,
          due_date=case when schedule_changed and coalesce(fields->>'repeat_rule','off')<>'off' then schedule_cursor
            else current_task.due_date end
          where id=current_task.id and owner_id=own_id;
      end loop;
    end if;
    -- Before a predecessor enters History, follow changes to its next due date.
    update public.tasks as previous set history_at=(next.due_date+coalesce(next.due_time,time '00:00')) at time zone 'Asia/Kolkata'
      from public.tasks as next where previous.owner_id=own_id and next.owner_id=own_id
      and previous.next_occurrence_id=next.id and previous.history_at>statement_timestamp()
      and (next.id=target.id or (edit_scope='future' and next.series_id=target.series_id));
  end if;
  select * into target from public.tasks where id=task_id and owner_id=own_id;
  select max(updated_at) into series_version from public.tasks where owner_id=own_id
    and (series_id=target.series_id or id=target.id) and deleted_at is null;
  return to_jsonb(target)||jsonb_build_object('series_version',series_version);
end;
$$;

-- Manual/admin-only until a separately approved scheduler activation. No user
-- can invoke this function. It preserves active/next tasks and series metadata.
create function public.task_app_purge_history()
returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
  delete from public.tasks where status='completed' and history_at<=statement_timestamp()-interval '30 days';
  get diagnostics removed=row_count;
  return removed;
end;
$$;

revoke all on function public.task_app_next_date(text,date,time,smallint[],smallint,timestamptz),
  public.task_app_prepare_repeat(),public.task_app_spawn_next(),
  public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz),public.task_app_purge_history()
  from public,anon,authenticated,service_role;
grant execute on function public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) to authenticated;
grant insert(repeat_rule) on public.tasks to authenticated;
revoke update on public.tasks from authenticated;
revoke update(title,notes,status,due_date,due_time,priority,category_id,weekdays,deleted_at) on public.tasks from authenticated;
notify pgrst,'reload schema';
commit;
