-- LOCAL REVIEW FIRST. No managed Auth table is modified by this feature.
begin;
alter table public.account_members add column left_at timestamptz;
drop index public.account_members_unique_name;
create unique index account_members_unique_name on public.account_members(owner_id,lower(name)) where left_at is null;
drop policy account_members_owner_read on public.account_members;
create policy account_members_owner_read on public.account_members for select to authenticated
  using(owner_id=auth.uid() and left_at is null);

create or replace function public.task_app_current_member()
returns public.account_members language sql stable security definer set search_path='' as $$
  select m from public.account_members m join public.account_member_sessions s
    on s.owner_id=m.owner_id and s.member_id=m.id
    join auth.sessions a on a.id=s.session_id and a.user_id=s.owner_id
    where m.left_at is null and s.owner_id=auth.uid() and s.session_id=nullif(auth.jwt()->>'session_id','')::uuid;
$$;
create or replace function public.task_app_member_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid(); current_member public.account_members; members jsonb;
begin
  if own_id is null or nullif(auth.jwt()->>'session_id','') is null or not exists(
    select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=own_id) then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  if exists(select 1 from public.account_member_sessions s join public.account_members m
    on m.owner_id=s.owner_id and m.id=s.member_id
    where s.owner_id=own_id and s.session_id=nullif(auth.jwt()->>'session_id','')::uuid and m.left_at is not null) then
    raise exception 'Profile session ended' using errcode='42501';
  end if;
  current_member:=public.task_app_current_member();
  if current_member.id is not null and current_member.last_seen_at<statement_timestamp()-interval '5 minutes' then
    update public.account_members set last_seen_at=statement_timestamp()
      where id=current_member.id and owner_id=own_id returning * into current_member;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at,
    'last_seen_at',last_seen_at) order by created_at,id),'[]'::jsonb) into members
    from public.account_members where owner_id=own_id and left_at is null;
  return jsonb_build_object('members',members,'current',case when current_member.id is null then null
    else jsonb_build_object('id',current_member.id,'name',current_member.name,
      'created_at',current_member.created_at,'last_seen_at',current_member.last_seen_at) end);
end;
$$;
create or replace function public.task_app_choose_member(member_id uuid default null,member_name text default null)
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
  if exists(select 1 from public.account_member_sessions s join public.account_members m
    on m.owner_id=s.owner_id and m.id=s.member_id
    where s.owner_id=own_id and s.session_id=nullif(auth.jwt()->>'session_id','')::uuid and m.left_at is not null) then
    raise exception 'Profile session ended' using errcode='42501';
  end if;
  current_member:=public.task_app_current_member();
  -- A session's choice is stable: stale tabs/retries cannot change another task's attribution.
  if current_member.id is not null then return public.task_app_member_state(); end if;
  if member_id is not null and member_name is null then
    select * into selected from public.account_members where id=member_id and owner_id=own_id and left_at is null;
    if not found then raise exception 'Member unavailable' using errcode='42501'; end if;
  elsif member_id is null and member_name is not null then
    clean_name:=btrim(regexp_replace(member_name,'[[:space:]]+',' ','g'));
    if member_name ~ '[[:cntrl:]]' or clean_name='' or char_length(clean_name)>50 then
      raise exception 'Invalid name' using errcode='23514';
    end if;
    if exists(select 1 from public.account_members where owner_id=own_id and left_at is null and lower(name)=lower(clean_name)) then
      raise exception 'Name already exists' using errcode='23505';
    end if;
    if (select count(*) from public.account_members where owner_id=own_id and left_at is null)>=10 then
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

create or replace function public.task_app_set_completion_member()
returns trigger language plpgsql security definer set search_path='' as $$
declare member public.account_members;
begin
  if auth.uid() is not null then
    select m.* into member from public.account_members m
      join public.account_member_sessions s on s.member_id=m.id and s.owner_id=m.owner_id
      join auth.sessions a on a.id=s.session_id and a.user_id=s.owner_id
      where m.left_at is null and s.owner_id=auth.uid()
        and s.session_id=nullif(auth.jwt()->>'session_id','')::uuid for update of m;
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

-- Only the member selected in the verified session can edit or leave itself.
create function public.task_app_rename_member(member_name text,previous_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid(); member public.account_members; clean_name text;
begin
  if own_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(own_id::text,79));
  member:=public.task_app_current_member();
  if member.id is null then raise exception 'Profile unavailable' using errcode='42501'; end if;
  select * into member from public.account_members where id=member.id and owner_id=own_id and left_at is null for update;
  if not found then raise exception 'Profile unavailable' using errcode='42501'; end if;
  clean_name:=btrim(regexp_replace(member_name,'[[:space:]]+',' ','g'));
  if member_name is null or member_name ~ '[[:cntrl:]]' or clean_name='' or char_length(clean_name)>50 then
    raise exception 'Invalid name' using errcode='23514';
  end if;
  -- An identical retry is successful without replacing a newer different name.
  if clean_name=member.name then return public.task_app_member_state(); end if;
  if previous_name is distinct from member.name then raise exception 'Name changed' using errcode='P0011'; end if;
  update public.account_members set name=clean_name where id=member.id and owner_id=own_id and left_at is null;
  return public.task_app_member_state();
end;
$$;
create function public.task_app_leave_member()
returns boolean language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid(); session_value uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
  member public.account_members;
begin
  if own_id is null or session_value is null or not exists(
    select 1 from auth.sessions where id=session_value and user_id=own_id) then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(own_id::text,79));
  select m.* into member from public.account_members m join public.account_member_sessions s
    on s.member_id=m.id and s.owner_id=m.owner_id
    where s.owner_id=own_id and s.session_id=session_value for update of m;
  if not found then raise exception 'Profile unavailable' using errcode='42501'; end if;
  if member.left_at is not null then return true; end if;
  update public.account_members set left_at=statement_timestamp() where id=member.id and owner_id=own_id;
  -- Keep bindings as revocation records. All linked sessions fail app reads,
  -- selections and writes; their next request clears their browser login.
  -- Never delete Auth users/sessions or shared tasks/metadata/history here.
  return true;
end;
$$;
revoke all on function public.task_app_rename_member(text,text),public.task_app_leave_member()
  from public,anon,authenticated,service_role;
grant execute on function public.task_app_rename_member(text,text),public.task_app_leave_member() to authenticated;
notify pgrst,'reload schema';
commit;
