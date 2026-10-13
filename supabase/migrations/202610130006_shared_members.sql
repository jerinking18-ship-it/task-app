-- Reviewed locally first. Apply before publishing the member-aware application.
begin;

create table public.account_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name=btrim(name) and char_length(name) between 1 and 50 and name !~ '[[:cntrl:]]'),
  created_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  unique(owner_id,id)
);
create unique index account_members_unique_name on public.account_members(owner_id,lower(name));
create table public.account_member_sessions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  member_id uuid not null,
  primary key(owner_id,session_id),
  foreign key(owner_id,member_id) references public.account_members(owner_id,id)
);
alter table public.account_members enable row level security;
alter table public.account_member_sessions enable row level security;
create policy account_members_owner_read on public.account_members for select to authenticated using(owner_id=auth.uid());
revoke all on public.account_members,public.account_member_sessions from public,anon,authenticated,service_role;
grant select on public.account_members to authenticated;

-- The session claim is verified by Supabase; a member id is not an account login.
create function public.task_app_current_member()
returns public.account_members language sql stable security definer set search_path='' as $$
  select m from public.account_members m join public.account_member_sessions s
    on s.owner_id=m.owner_id and s.member_id=m.id
    where s.owner_id=auth.uid() and s.session_id=nullif(auth.jwt()->>'session_id','')::uuid;
$$;
create function public.task_app_member_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid(); current_member public.account_members; members jsonb;
begin
  if own_id is null or nullif(auth.jwt()->>'session_id','') is null then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  current_member:=public.task_app_current_member();
  if current_member.id is not null and current_member.last_seen_at<statement_timestamp()-interval '5 minutes' then
    update public.account_members set last_seen_at=statement_timestamp()
      where id=current_member.id and owner_id=own_id returning * into current_member;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at,
    'last_seen_at',last_seen_at) order by created_at,id),'[]'::jsonb) into members
    from public.account_members where owner_id=own_id;
  return jsonb_build_object('members',members,'current',case when current_member.id is null then null
    else jsonb_build_object('id',current_member.id,'name',current_member.name,
      'created_at',current_member.created_at,'last_seen_at',current_member.last_seen_at) end);
end;
$$;
create function public.task_app_choose_member(member_id uuid default null,member_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid(); session_value uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
  selected public.account_members; current_member public.account_members; clean_name text;
begin
  if own_id is null or session_value is null or not exists(
    select 1 from auth.sessions where id=session_value and user_id=own_id) then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  -- Serializes count + insert across devices; the limit cannot race to 11.
  perform pg_advisory_xact_lock(hashtextextended(own_id::text,79));
  current_member:=public.task_app_current_member();
  -- A session's choice is stable: stale tabs/retries cannot change another task's attribution.
  if current_member.id is not null then return public.task_app_member_state(); end if;
  if member_id is not null and member_name is null then
    select * into selected from public.account_members where id=member_id and owner_id=own_id;
    if not found then raise exception 'Member unavailable' using errcode='42501'; end if;
  elsif member_id is null and member_name is not null then
    clean_name:=btrim(regexp_replace(member_name,'[[:space:]]+',' ','g'));
    if member_name ~ '[[:cntrl:]]' or clean_name='' or char_length(clean_name)>50 then
      raise exception 'Invalid name' using errcode='23514';
    end if;
    if exists(select 1 from public.account_members where owner_id=own_id and lower(name)=lower(clean_name)) then
      raise exception 'Name already exists' using errcode='23505';
    end if;
    if (select count(*) from public.account_members where owner_id=own_id)>=10 then
      raise exception 'Member limit reached' using errcode='P0010';
    end if;
    insert into public.account_members(owner_id,name) values(own_id,clean_name) returning * into selected;
  else raise exception 'Choose or create a member' using errcode='23514';
  end if;
  insert into public.account_member_sessions(owner_id,session_id,member_id) values(own_id,session_value,selected.id);
  update public.account_members set last_seen_at=statement_timestamp() where id=selected.id and owner_id=own_id;
  return public.task_app_member_state();
end;
$$;

alter table public.tasks add column completed_by_member_id uuid,
  add column completed_by_name text,
  add constraint tasks_completion_member_pair check (
    (completed_by_member_id is null and completed_by_name is null) or
    (status='completed' and completed_by_member_id is not null and completed_by_name is not null
      and char_length(completed_by_name) between 1 and 50)),
  add constraint tasks_completion_member_owner foreign key(owner_id,completed_by_member_id)
    references public.account_members(owner_id,id);

create function public.task_app_set_completion_member()
returns trigger language plpgsql security definer set search_path='' as $$
declare member public.account_members;
begin
  if auth.uid() is not null then
    member:=public.task_app_current_member();
    if member.id is null or member.owner_id<>new.owner_id then
      raise exception 'Choose your account member before saving tasks' using errcode='42501';
    end if;
    update public.account_members set last_seen_at=statement_timestamp()
      where id=member.id and last_seen_at<statement_timestamp()-interval '5 minutes';
  end if;
  if new.status='active' then
    new.completed_by_member_id:=null; new.completed_by_name:=null;
  elsif tg_op='UPDATE' and old.status='completed' then
    new.completed_by_member_id:=old.completed_by_member_id; new.completed_by_name:=old.completed_by_name;
  elsif member.id is not null then
    new.completed_by_member_id:=member.id; new.completed_by_name:=member.name;
  else
    new.completed_by_member_id:=null; new.completed_by_name:=null;
  end if;
  return new;
end;
$$;
create trigger tasks_completion_member before insert or update on public.tasks
  for each row execute function public.task_app_set_completion_member();

-- Existing task write grants are column-specific: new metadata is never writable.
revoke all on function public.task_app_current_member(),public.task_app_member_state(),
  public.task_app_choose_member(uuid,text),public.task_app_set_completion_member()
  from public,anon,authenticated,service_role;
grant execute on function public.task_app_member_state(),public.task_app_choose_member(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
