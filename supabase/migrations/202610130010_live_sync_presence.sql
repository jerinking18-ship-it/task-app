-- LOCAL REVIEW FIRST. Adds activity leases and private change notifications.
-- No task/Auth records are deleted or changed by applying this migration.
begin;
do $$ begin
  if not exists(select 1 from pg_class where oid='realtime.messages'::regclass and relrowsecurity) then
    raise exception 'Realtime authorization must be enabled before live sync';
  end if;
end $$;
create table public.account_member_presence (
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  tab_id uuid not null,
  member_id uuid not null,
  sequence_number bigint not null check(sequence_number between 1 and 9007199254740991),
  active_until timestamptz not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key(owner_id,session_id,tab_id),
  foreign key(owner_id,member_id) references public.account_members(owner_id,id)
);
create index account_member_presence_active_idx on public.account_member_presence(owner_id,member_id,active_until);
alter table public.account_member_presence enable row level security;
revoke all on public.account_member_presence from public,anon,authenticated,service_role;

-- Reading the list does not manufacture user activity. Active status requires
-- an unexpired foreground-tab lease backed by a real, still-valid Auth session.
create or replace function public.task_app_member_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid();session_value uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
  current_id uuid;members jsonb;current_value jsonb;
begin
  if own_id is null or session_value is null or not exists(select 1 from auth.sessions where id=session_value and user_id=own_id) then
    raise exception 'Sign in required' using errcode='42501';end if;
  if exists(select 1 from public.account_member_sessions s join public.account_members m on m.owner_id=s.owner_id and m.id=s.member_id
    where s.owner_id=own_id and s.session_id=session_value and m.left_at is not null) then
    raise exception 'Profile session ended' using errcode='42501';end if;
  current_id:=(public.task_app_current_member()).id;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'created_at',m.created_at,
    'last_seen_at',m.last_seen_at,'active_until',(
      select max(p.active_until) from public.account_member_presence p join auth.sessions a on a.id=p.session_id and a.user_id=p.owner_id
        join public.account_member_sessions s on s.owner_id=p.owner_id and s.session_id=p.session_id and s.member_id=p.member_id
      where p.owner_id=m.owner_id and p.member_id=m.id and p.active_until>statement_timestamp())) order by m.created_at,m.id),'[]'::jsonb)
    into members from public.account_members m where m.owner_id=own_id and m.left_at is null;
  select e into current_value from jsonb_array_elements(members) e where e->>'id'=current_id::text;
  return jsonb_build_object('members',members,'current',current_value,'server_now',statement_timestamp());
end;
$$;

create function public.task_app_presence(tab_id uuid,is_active boolean,client_sequence bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid();session_value uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
  member public.account_members;previous public.account_member_presence;
begin
  if own_id is null or session_value is null or not exists(select 1 from auth.sessions where id=session_value and user_id=own_id) then
    raise exception 'Sign in required' using errcode='42501';end if;
  if tab_id is null or is_active is null or client_sequence is null or client_sequence not between 1 and 9007199254740991 then
    raise exception 'Invalid activity request' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(own_id::text||session_value::text,91));
  select m.* into member from public.account_members m join public.account_member_sessions s
    on s.owner_id=m.owner_id and s.member_id=m.id where m.left_at is null and s.owner_id=own_id and s.session_id=session_value for update of m;
  if not found then raise exception 'Choose your name' using errcode='42501';end if;
  -- Activity rows are transient, not user data/history. Keep this table bounded.
  delete from public.account_member_presence p where p.owner_id=own_id and p.updated_at<statement_timestamp()-interval '1 day';
  select * into previous from public.account_member_presence p where p.owner_id=own_id and p.session_id=session_value and p.tab_id=task_app_presence.tab_id;
  if found and previous.sequence_number>=client_sequence then return public.task_app_member_state();end if;
  if previous.tab_id is null and (select count(*) from public.account_member_presence where owner_id=own_id and session_id=session_value)>=64 then
    raise exception 'Too many open tabs' using errcode='23514';end if;
  insert into public.account_member_presence(owner_id,session_id,tab_id,member_id,sequence_number,active_until)
    values(own_id,session_value,tab_id,member.id,client_sequence,statement_timestamp()+case when is_active then interval '65 seconds' else interval '0 seconds' end)
    on conflict on constraint account_member_presence_pkey do update set sequence_number=excluded.sequence_number,
      active_until=excluded.active_until,updated_at=statement_timestamp();
  if is_active or (previous.tab_id is not null and previous.active_until>statement_timestamp()) then
    update public.account_members set last_seen_at=greatest(last_seen_at,statement_timestamp()) where id=member.id and owner_id=own_id;
  end if;
  return public.task_app_member_state();
end;
$$;

-- Broadcast only invalidations; task text/member names never enter the channel.
-- Refetch APIs continue to validate the current session and selected member.
create function public.task_app_notify_sync()
returns trigger language plpgsql security definer set search_path='' as $$
declare own_id uuid;
begin
  if tg_op='DELETE' then own_id:=old.owner_id;else own_id:=new.owner_id;end if;
  begin
    perform realtime.send(jsonb_build_object('scope',tg_argv[0]),'changed','task-account:'||own_id::text,true);
  exception when others then
    -- A notification outage must not roll back an otherwise valid task write.
    -- Visible clients perform a bounded automatic catch-up refresh as well.
    null;
  end;
  return null;
end;
$$;
create trigger tasks_live_sync after insert or update or delete on public.tasks for each row execute function public.task_app_notify_sync('tasks');
create trigger categories_live_sync after insert or update or delete on public.categories for each row execute function public.task_app_notify_sync('tasks');
create trigger settings_live_sync after insert or update or delete on public.account_settings for each row execute function public.task_app_notify_sync('tasks');
create trigger members_live_sync after insert or update or delete on public.account_members for each row execute function public.task_app_notify_sync('members');
create trigger presence_live_sync after insert or update or delete on public.account_member_presence for each row execute function public.task_app_notify_sync('members');
create trigger member_sessions_live_sync after insert or update or delete on public.account_member_sessions for each row execute function public.task_app_notify_sync('members');
create function public.task_app_can_receive_sync()
returns boolean language sql stable security definer set search_path='' as $$
  select (public.task_app_current_member()).id is not null;
$$;
create policy task_app_receive_account_sync on realtime.messages for select to authenticated
  using(extension='broadcast' and topic='task-account:'||auth.uid()::text and realtime.topic()='task-account:'||auth.uid()::text and public.task_app_can_receive_sync());
revoke all on function public.task_app_presence(uuid,boolean,bigint),public.task_app_notify_sync(),public.task_app_can_receive_sync() from public,anon,authenticated,service_role;
grant execute on function public.task_app_presence(uuid,boolean,bigint),public.task_app_can_receive_sync() to authenticated;
notify pgrst,'reload schema';
commit;
