-- LOCAL REVIEW FIRST. No data is deleted by applying this migration.
-- A live future reservation survives clearing its completed predecessor. Other
-- deletion paths retain the existing FK cascade, including Bin purge behavior.
begin;
alter table public.task_repeat_pending alter column source_task_id drop not null;

create function public.task_app_completed(operation text, expected_count bigint default null,
  expected_snapshot text default null, confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid(); member public.account_members; target public.tasks;
  ids uuid[]; actual_count bigint; actual_snapshot text; removed bigint;
begin
  member:=public.task_app_current_member();
  if own_id is null or member.id is null then raise exception 'Sign in and choose your name' using errcode='42501';end if;
  if operation is null or operation not in ('preview','purge') then raise exception 'Invalid completed operation' using errcode='23514';end if;
  if operation='purge' then
    if confirmed is distinct from true or expected_count is null or expected_count<1
      or expected_snapshot is null or expected_snapshot !~ '^[a-f0-9]{32}$' then
      raise exception 'Explicit current confirmation required' using errcode='23514';end if;
    -- Same account/series/row ordering as Bin and task edits. Capture exact IDs
    -- first; a newly completed task can never be silently added to the deletion.
    perform pg_advisory_xact_lock(hashtextextended(own_id::text,90));
    select array_agg(id order by id) into ids from public.tasks where owner_id=own_id and status='completed'
      and deleted_at is null and (history_at is null or history_at>statement_timestamp())
      and (available_at is null or available_at<=statement_timestamp());
    for target in select * from public.tasks where owner_id=own_id and id=any(ids) order by coalesce(series_id,id),id loop
      perform pg_advisory_xact_lock(hashtextextended(coalesce(target.series_id,target.id)::text,0));
    end loop;
    perform 1 from public.tasks where owner_id=own_id and id=any(ids) order by id for update;
    select * into member from public.account_members where owner_id=own_id and left_at is null
      and id=(public.task_app_current_member()).id for update;
    if not found then raise exception 'Profile session ended' using errcode='42501';end if;
  end if;
  -- Deliberately independent of browser search, category and priority filters.
  select count(*),md5(coalesce(string_agg(id::text||':'||extract(epoch from updated_at)::text,'|' order by id),''))
    into actual_count,actual_snapshot from public.tasks where owner_id=own_id and status='completed'
      and deleted_at is null and (history_at is null or history_at>statement_timestamp())
      and (available_at is null or available_at<=statement_timestamp());
  if operation='preview' then return jsonb_build_object('count',actual_count,'snapshot',actual_snapshot);end if;
  if actual_count<>expected_count or actual_snapshot<>expected_snapshot or coalesce(cardinality(ids),0)<>actual_count then
    raise exception 'Completed tasks changed' using errcode='P0013';end if;
  -- Queue payload is the independent schedule, not an archived completed task.
  -- Detach only live reservations so physical deletion cannot cascade their loss.
  update public.task_repeat_pending set source_task_id=null where owner_id=own_id and source_task_id=any(ids)
    and generated_at is null and not cancelled;
  delete from public.tasks where owner_id=own_id and id=any(ids) and status='completed' and deleted_at is null
    and (history_at is null or history_at>statement_timestamp()) and (available_at is null or available_at<=statement_timestamp());
  get diagnostics removed=row_count;
  if removed<>actual_count then raise exception 'Completed tasks changed' using errcode='P0013';end if;
  return jsonb_build_object('deleted',removed,'snapshot',actual_snapshot);
end;
$$;
revoke all on function public.task_app_completed(text,bigint,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.task_app_completed(text,bigint,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
