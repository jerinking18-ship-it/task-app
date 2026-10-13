-- LOCAL REVIEW FIRST. Add recoverable Bin and selected-member, version-checked actions.
-- No rows are deleted by this migration. No Auth, scheduler or client DELETE grants.
begin;
alter table public.tasks add column deleted_by_member_id uuid, add column deleted_by_name text,
  add constraint tasks_deleted_member_owner foreign key(owner_id,deleted_by_member_id) references public.account_members(owner_id,id),
  add constraint tasks_deleted_member_pair check((deleted_by_member_id is null and deleted_by_name is null) or
    (deleted_at is not null and deleted_by_member_id is not null and deleted_by_name is not null and char_length(deleted_by_name) between 1 and 50));
alter table public.task_series add column stopped_at timestamptz, add column bin_restarted_from uuid,
  add constraint task_series_bin_parent_owner foreign key(owner_id,bin_restarted_from) references public.task_series(owner_id,id);
create unique index task_series_bin_restart_once on public.task_series(owner_id,bin_restarted_from) where bin_restarted_from is not null;
create index tasks_owner_bin_idx on public.tasks(owner_id,deleted_at desc,id) where deleted_at is not null;

create function public.task_app_bin_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
declare member public.account_members;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    member:=public.task_app_current_member();
    if auth.uid() is not null and (member.id is null or member.owner_id<>new.owner_id) then
      raise exception 'Choose your name before moving tasks to Bin' using errcode='42501'; end if;
    new.deleted_at:=statement_timestamp();
    new.deleted_by_member_id:=member.id;new.deleted_by_name:=member.name;
  elsif old.deleted_at is not null and new.deleted_at is null then
    new.deleted_by_member_id:=null;new.deleted_by_name:=null;
  else
    new.deleted_by_member_id:=old.deleted_by_member_id;new.deleted_by_name:=old.deleted_by_name;
  end if;
  return new;
end;
$$;
create trigger tasks_bin_stamp before update on public.tasks for each row execute function public.task_app_bin_stamp();

-- Keep the existing task mutation private, and stop recurrence only after a
-- successful version-checked move. A stale request never cancels a schedule.
alter function public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) rename to task_app_mutate_before_bin;
revoke all on function public.task_app_mutate_before_bin(uuid,timestamptz,text,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
create function public.task_app_mutate(task_id uuid,expected_version timestamptz,operation text,
 fields jsonb default null,new_status text default null,edit_scope text default 'this',expected_series_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.tasks;result jsonb;own_id uuid:=auth.uid();member public.account_members;
begin
  if operation='delete' then
    member:=public.task_app_current_member();
    if own_id is null or member.id is null then raise exception 'Sign in and choose your name' using errcode='42501';end if;
    perform pg_advisory_xact_lock(hashtextextended(own_id::text,90));
    select * into target from public.tasks where owner_id=own_id and id=task_id and deleted_at is null;
  end if;
  result:=public.task_app_mutate_before_bin(task_id,expected_version,operation,fields,new_status,edit_scope,expected_series_version);
  if operation='delete' and result is not null and coalesce(result->>'conflict','false')<>'true' and target.series_id is not null then
    update public.task_series set stopped_at=statement_timestamp() where owner_id=own_id and id=target.series_id;
    update public.task_repeat_pending set cancelled=true,updated_at=statement_timestamp()
      where owner_id=own_id and series_id=target.series_id and generated_at is null;
    -- Preserve every existing occurrence and its content/status/completion names.
    -- The deleted task retains its old repeat rule as its restoration snapshot.
    update public.tasks set repeat_rule='off',repeat_anchor_day=null
      where owner_id=own_id and series_id=target.series_id and deleted_at is null and repeat_rule<>'off';
  end if;
  return result;
end;
$$;

create function public.task_app_bin(operation text,selections jsonb,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid();member public.account_members;target public.tasks;head public.tasks;
  chosen record;chain_parent uuid;child public.task_series;new_series uuid;next_id uuid;next_day date;
  ids uuid[];targets jsonb;valid_count integer;resumed integer:=0;already_running boolean;
begin
  member:=public.task_app_current_member();
  if own_id is null or member.id is null then raise exception 'Sign in and choose your name' using errcode='42501';end if;
  if operation is null or operation not in ('restore','purge') or confirmed is distinct from true or jsonb_typeof(selections) is distinct from 'array'
    or jsonb_array_length(selections) not between 1 and 1000 then raise exception 'Invalid Bin selection' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(selections) e where jsonb_typeof(e)<>'object' or e->>'id' is null or e->>'version' is null
    or (select count(*) from jsonb_object_keys(e))<>2) then raise exception 'Invalid Bin item' using errcode='23514';end if;
  select array_agg((e->>'id')::uuid) into ids from jsonb_array_elements(selections) e;
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'Duplicate Bin selection' using errcode='23514';end if;
  -- One account Bin transaction at a time, then the same series-before-row order
  -- used by completion/edit and the midnight worker. All selected versions must
  -- match before the first row changes: bulk actions are all-or-nothing.
  perform pg_advisory_xact_lock(hashtextextended(own_id::text,90));
  for target in select * from public.tasks where owner_id=own_id and id=any(ids) order by coalesce(series_id,id),id loop
    perform pg_advisory_xact_lock(hashtextextended(coalesce(target.series_id,target.id)::text,0));
  end loop;
  perform 1 from public.tasks where owner_id=own_id and id=any(ids) order by id for update;
  select count(*) into valid_count from public.tasks t join jsonb_array_elements(selections) e on t.id=(e->>'id')::uuid
    where t.owner_id=own_id and t.deleted_at is not null and t.updated_at=(e->>'version')::timestamptz;
  if valid_count<>cardinality(ids) then raise exception 'Bin selection changed' using errcode='P0012';end if;
  -- Recheck and lock the selected active profile after waiting for task locks.
  -- A concurrent leave cannot authorize a purge with a revoked profile.
  select * into member from public.account_members where owner_id=own_id and left_at is null
    and id=(public.task_app_current_member()).id for update;
  if not found then raise exception 'Profile session ended' using errcode='42501';end if;
  select jsonb_agg(to_jsonb(t) order by occurrence_number desc,id) into targets from public.tasks t where t.owner_id=own_id and t.id=any(ids);
  if operation='purge' then
    -- Legacy Bin records may predate repeat cancellation. Purging one also
    -- stops its original series, while keeping already-created tasks intact.
    for chosen in select distinct (e->>'series_id')::uuid as series_id from jsonb_array_elements(targets) e where e->>'series_id' is not null loop
      update public.task_series set stopped_at=statement_timestamp() where owner_id=own_id and id=chosen.series_id;
      update public.task_repeat_pending set cancelled=true,updated_at=statement_timestamp() where owner_id=own_id and series_id=chosen.series_id and generated_at is null;
      update public.tasks set repeat_rule='off',repeat_anchor_day=null where owner_id=own_id and series_id=chosen.series_id and deleted_at is null and repeat_rule<>'off';
    end loop;
    delete from public.tasks where owner_id=own_id and id=any(ids) and deleted_at is not null;
  else
    -- Completed items return to Completed; exact completion time/name survive.
    -- Start each resumed series once, using its newest surviving occurrence.
    update public.tasks set deleted_at=null,history_at=null,repeat_rule='off',repeat_anchor_day=null
      where owner_id=own_id and id=any(ids);
    for chosen in select distinct on ((e->>'series_id')::uuid) e as snapshot
      from jsonb_array_elements(targets) e where e->>'repeat_rule'<>'off' and e->>'series_id' is not null
      order by (e->>'series_id')::uuid,(e->>'occurrence_number')::integer desc,e->>'id' loop
      chain_parent:=(chosen.snapshot->>'series_id')::uuid;already_running:=false;
      -- A second restore from the same old series cannot start another repeat.
      -- A later deletion stops the new series; restoring can then resume it once.
      loop
        select * into child from public.task_series where owner_id=own_id and bin_restarted_from=chain_parent;
        exit when not found;
        if child.stopped_at is null then already_running:=true;exit;end if;
        chain_parent:=child.id;
      end loop;
      if already_running then continue;end if;
      -- Legacy Bin rows may belong to a series which is still running already.
      if exists(select 1 from public.tasks where owner_id=own_id and series_id=(chosen.snapshot->>'series_id')::uuid
        and deleted_at is null and repeat_rule<>'off') then continue;end if;
      select * into head from public.tasks where owner_id=own_id and series_id=(chosen.snapshot->>'series_id')::uuid and deleted_at is null
        order by occurrence_number desc,created_at desc,id limit 1 for update;
      if not found then continue;end if;
      -- Retain an already-created future head instead of duplicating it. If it
      -- was edited to an incompatible weekday, use the selected valid snapshot.
      if head.due_date is null or (chosen.snapshot->>'repeat_rule'='weekly' and not coalesce(extract(dow from head.due_date)::smallint=any(head.weekdays),false)) then
        select * into head from public.tasks where owner_id=own_id and id=(chosen.snapshot->>'id')::uuid for update;
      end if;
      -- Cancel any legacy reservation before replacing it with this single
      -- resumed series. No other running/restored child is touched.
      update public.task_series set stopped_at=statement_timestamp() where owner_id=own_id and id=(chosen.snapshot->>'series_id')::uuid;
      update public.task_repeat_pending set cancelled=true,updated_at=statement_timestamp() where owner_id=own_id and series_id=(chosen.snapshot->>'series_id')::uuid and generated_at is null;
      insert into public.task_series(owner_id,bin_restarted_from) values(own_id,chain_parent) returning id into new_series;
      update public.tasks set series_id=new_series,occurrence_number=0,next_occurrence_id=null,history_at=null,
        repeat_rule=chosen.snapshot->>'repeat_rule',repeat_anchor_day=(chosen.snapshot->>'repeat_anchor_day')::smallint
        where owner_id=own_id and id=head.id returning * into head;
      if head.status='completed' then
        -- Replace only this source’s cancelled/already-generated reservation.
        -- A fresh series has a new identity; live queues are never removed.
        delete from public.task_repeat_pending where owner_id=own_id and source_task_id=head.id and (cancelled or generated_at is not null);
        next_day:=public.task_app_next_date(head.repeat_rule,head.due_date,head.due_time,head.weekdays,head.repeat_anchor_day,statement_timestamp());
        next_id:=gen_random_uuid();
        insert into public.task_repeat_pending(id,owner_id,source_task_id,series_id,occurrence_number,due_date,payload)
          values(next_id,own_id,head.id,new_series,1,next_day,jsonb_build_object('title',head.title,'notes',head.notes,'due_time',head.due_time,
          'priority',head.priority,'category_id',head.category_id,'weekdays',to_jsonb(head.weekdays),'repeat_rule',head.repeat_rule,'repeat_anchor_day',head.repeat_anchor_day));
        update public.tasks set next_occurrence_id=next_id where owner_id=own_id and id=head.id;
      end if;
      resumed:=resumed+1;
    end loop;
  end if;
  return jsonb_build_object('action',operation,'ids',to_jsonb(ids),'resumed',resumed);
end;
$$;

-- Existing History retention never silently purges recoverable Bin records.
create or replace function public.task_app_purge_history()
returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
  delete from public.tasks where status='completed' and deleted_at is null and history_at<=statement_timestamp()-interval '30 days';
  get diagnostics removed=row_count;return removed;
end;
$$;
revoke all on function public.task_app_bin_stamp(),public.task_app_bin(text,jsonb,boolean),
 public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.task_app_bin(text,jsonb,boolean),public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
