-- Reviewed local implementation. Additive; no account/task deletion or automatic ownership claim.
-- Apply ONCE only after the separate live approval. Bootstrap is a separate admin step.
begin;
create table public.task_workspaces (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique references auth.users(id) on delete restrict,
 name text not null default 'BGM Workspace' check(char_length(name) between 1 and 80),
 created_at timestamptz not null default statement_timestamp()
);
alter table public.account_members add column auth_user_id uuid references auth.users(id) on delete restrict,
 add column role text not null default 'member' check(role in ('owner','coordinator','member'));
create unique index account_members_identity on public.account_members(auth_user_id) where left_at is null and auth_user_id is not null;
create unique index account_members_one_owner on public.account_members(owner_id) where role='owner' and left_at is null;
alter table public.tasks add column assigned_to_member_id uuid,
 add constraint tasks_assignee_workspace foreign key(owner_id,assigned_to_member_id) references public.account_members(owner_id,id);
alter table public.task_series add column assigned_to_member_id uuid,
 add constraint series_assignee_workspace foreign key(owner_id,assigned_to_member_id) references public.account_members(owner_id,id);
create index tasks_assignee on public.tasks(owner_id,assigned_to_member_id,status) where deleted_at is null;
create table public.workspace_invitations (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.task_workspaces(owner_id) on delete restrict,
 email text not null check(email=lower(btrim(email)) and char_length(email) between 3 and 254),
 role text not null check(role in ('member','coordinator')),token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default statement_timestamp(),expires_at timestamptz not null default (statement_timestamp()+interval '7 days'),
 accepted_at timestamptz,revoked_at timestamptz,
 invited_by uuid not null references public.account_members(id),accepted_by uuid references auth.users(id)
);
alter table public.task_workspaces enable row level security;
alter table public.workspace_invitations enable row level security;
revoke all on public.task_workspaces,public.workspace_invitations from public,anon,authenticated,service_role;

create function public.task_app_verified_user() returns uuid language sql stable security definer set search_path='' as $$
 select u.id from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=auth.uid() and u.email_confirmed_at is not null
 and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and (s.not_after is null or s.not_after>statement_timestamp())
 and s.id=nullif(auth.jwt()->>'session_id','')::uuid;
$$;
create or replace function public.task_app_current_member() returns public.account_members language sql stable security definer set search_path='' as $$
 select m from public.account_members m join public.task_workspaces w on w.owner_id=m.owner_id
 where m.auth_user_id=public.task_app_verified_user() and m.left_at is null;
$$;
create function public.task_app_workspace_owner() returns uuid language sql stable security definer set search_path='' as $$
 select (public.task_app_current_member()).owner_id;
$$;
-- A shared workspace lock serializes all role/leave/assignment/task operations.
-- Membership is re-read AFTER acquiring it, never trusted from a stale JWT role.
create function public.task_app_require_role(manage boolean default false,owner_only boolean default false)
returns public.account_members language plpgsql security definer set search_path='' as $$
declare m public.account_members;own uuid;
begin
 own:=public.task_app_workspace_owner();
 if own is null then raise exception 'Verified workspace membership required' using errcode='P0403';end if;
 perform pg_advisory_xact_lock(hashtextextended(own::text,163));
 select * into m from public.account_members where owner_id=own and auth_user_id=public.task_app_verified_user() and left_at is null;
 if m.id is null or (manage and m.role not in ('owner','coordinator')) or (owner_only and m.role<>'owner') then
 raise exception 'Your current role does not allow this action' using errcode='P0403';end if;
 return m;
end;$$;

create or replace function public.task_app_member_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;items jsonb;invites jsonb;w public.task_workspaces;
begin
 if public.task_app_verified_user() is null then raise exception 'Verified sign in required' using errcode='42501';end if;
 m:=public.task_app_current_member();
 if m.id is null then return jsonb_build_object('current',null,'members','[]'::jsonb,'workspace',null,'invitations','[]'::jsonb,'server_now',statement_timestamp());end if;
 select * into w from public.task_workspaces where owner_id=m.owner_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'created_at',u.created_at,'last_seen_at',u.last_seen_at,
 'active_until',(select max(p.active_until) from public.account_member_presence p join auth.sessions s on s.id=p.session_id and s.user_id=u.auth_user_id
 where p.owner_id=u.owner_id and p.member_id=u.id and p.active_until>statement_timestamp())) order by u.created_at,u.id),'[]'::jsonb)
 into items from public.account_members u where u.owner_id=m.owner_id and u.left_at is null and u.auth_user_id is not null;
 if m.role='owner' then
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'expires_at',i.expires_at) order by i.created_at),'[]'::jsonb) into invites
 from public.workspace_invitations i where i.owner_id=m.owner_id and i.accepted_at is null and i.revoked_at is null and i.expires_at>statement_timestamp();
 else invites:='[]'::jsonb;end if;
 return jsonb_build_object('current',(select e from jsonb_array_elements(items)e where e->>'id'=m.id::text),'members',items,
 'workspace',jsonb_build_object('id',w.id,'owner_id',w.owner_id,'name',w.name,'reserved_seats',(select count(*) from public.workspace_invitations i where i.owner_id=m.owner_id and i.accepted_at is null and i.revoked_at is null and i.expires_at>statement_timestamp())),
 'invitations',invites,'server_now',statement_timestamp());
end;$$;

-- No publicly callable create/select-name bypass remains.
revoke all on function public.task_app_choose_member(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.task_app_set_completion_member() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.account_members;
begin
 m:=public.task_app_current_member();
 if new.status='active' then new.completed_by_member_id:=null;new.completed_by_name:=null;
 elsif tg_op='UPDATE' and old.status='completed' then new.completed_by_member_id:=old.completed_by_member_id;new.completed_by_name:=old.completed_by_name;
 elsif m.id is not null and m.owner_id=new.owner_id then new.completed_by_member_id:=m.id;new.completed_by_name:=m.name;
 else new.completed_by_member_id:=null;new.completed_by_name:=null;end if;
 return new;
end;$$;

-- Only administrator can explicitly bind the initial verified identity. No email
-- is hardcoded. A pre-existing single own profile is preserved; ambiguous legacy
-- membership needs a separately reviewed map. No data is erased.
create function public.task_app_bootstrap_workspace(user_id uuid,member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare member_id uuid;workspace_id uuid;
begin
 if not exists(select 1 from auth.users where id=user_id and email_confirmed_at is not null) then raise exception 'Verified identity required';end if;
 perform pg_advisory_xact_lock(hashtextextended(user_id::text,163));
 if exists(select 1 from public.task_workspaces where owner_id=user_id) then raise exception 'Workspace already initialized';end if;
 if member_name is null or btrim(member_name)='' or char_length(member_name)>50 or member_name ~ '[[:cntrl:]]' then raise exception 'Invalid name';end if;
 if (select count(*) from public.account_members where owner_id=user_id and left_at is null)>1 then raise exception 'Legacy profiles need explicit mapping';end if;
 insert into public.task_workspaces(owner_id) values(user_id) returning id into workspace_id;
 select id into member_id from public.account_members where owner_id=user_id and left_at is null;
 if member_id is null then insert into public.account_members(owner_id,auth_user_id,name,role) values(user_id,user_id,btrim(member_name),'owner') returning id into member_id;
 else update public.account_members set auth_user_id=user_id,role='owner' where id=member_id;end if;
 update public.tasks set assigned_to_member_id=member_id where owner_id=user_id and assigned_to_member_id is null;
 update public.task_series set assigned_to_member_id=member_id where owner_id=user_id and assigned_to_member_id is null;
 return workspace_id;
end;$$;

-- Retained implementation from migrations001–014: task_app_mutate_task
CREATE OR REPLACE FUNCTION public.task_app_mutate_task(task_id uuid, expected_version timestamp with time zone, operation text, fields jsonb DEFAULT NULL::jsonb, new_status text DEFAULT NULL::text, edit_scope text DEFAULT 'this'::text, expected_series_version timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.tasks; current_task public.tasks; own_id uuid:=public.task_app_workspace_owner();
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
$function$
;

-- Retained implementation from migrations001–014: task_app_mutate_before_bin
CREATE OR REPLACE FUNCTION public.task_app_mutate_before_bin(task_id uuid, expected_version timestamp with time zone, operation text, fields jsonb DEFAULT NULL::jsonb, new_status text DEFAULT NULL::text, edit_scope text DEFAULT 'this'::text, expected_series_version timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.tasks; result jsonb; pending public.task_repeat_pending;
  own_id uuid:=public.task_app_workspace_owner(); schedule_changed boolean; cursor_date date; anchor smallint;
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
$function$
;

-- Retained implementation from migrations001–014: task_app_mutate
CREATE OR REPLACE FUNCTION public.task_app_legacy_mutate(task_id uuid, expected_version timestamp with time zone, operation text, fields jsonb DEFAULT NULL::jsonb, new_status text DEFAULT NULL::text, edit_scope text DEFAULT 'this'::text, expected_series_version timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.tasks;result jsonb;own_id uuid:=public.task_app_workspace_owner();member public.account_members;
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
$function$
;

-- Retained implementation from migrations001–014: task_app_bin
CREATE OR REPLACE FUNCTION public.task_app_legacy_bin(operation text, selections jsonb, confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare own_id uuid:=public.task_app_workspace_owner();member public.account_members;target public.tasks;head public.tasks;
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
      insert into public.task_series(owner_id,bin_restarted_from,assigned_to_member_id) values(own_id,chain_parent,(select assigned_to_member_id from public.task_series where id=(chosen.snapshot->>'series_id')::uuid and owner_id=own_id)) returning id into new_series;
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
$function$
;

-- Retained implementation from migrations001–014: task_app_bin_items
CREATE OR REPLACE FUNCTION public.task_app_legacy_bin_items(operation text, selections jsonb, confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare own_id uuid:=public.task_app_workspace_owner();member public.account_members;task_items jsonb;template_items jsonb;template_ids uuid[];
 chosen record;valid_count integer;result_items jsonb;
begin
 member:=public.task_app_current_member();
 if own_id is null or member.id is null then raise exception 'Choose your name' using errcode='42501';end if;
 if operation is null or operation not in ('restore','purge') or confirmed is distinct from true or jsonb_typeof(selections) is distinct from 'array'
  or jsonb_array_length(selections) not between 1 and 1000 then raise exception 'Invalid Bin selection' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(selections) e where jsonb_typeof(e)<>'object'
  or (select count(*) from jsonb_object_keys(e))<>3 or e->>'kind' is null or e->>'kind' not in ('task','template')
  or e->>'id' is null or e->>'version' is null) then raise exception 'Invalid Bin item' using errcode='23514';end if;
 if (select count(distinct (e->>'kind', (e->>'id')::uuid)) from jsonb_array_elements(selections) e)<>jsonb_array_length(selections)
  then raise exception 'Duplicate Bin item' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','version',e->>'version')) filter(where e->>'kind'='task'),'[]'::jsonb),
  coalesce(jsonb_agg(e) filter(where e->>'kind'='template'),'[]'::jsonb) into task_items,template_items from jsonb_array_elements(selections) e;
 perform pg_advisory_xact_lock(hashtextextended(own_id::text,90));
 if jsonb_array_length(task_items)>0 then perform public.task_app_bin(operation,task_items,true);end if;
 -- Account Bin lock first, existing task series/row locks second (inside task_app_bin),
 -- selected profile third, template advisory/row locks last. Save/remove take the
 -- profile before a template lock, so a profile revocation or template edit is safe.
 select * into member from public.account_members where owner_id=own_id and left_at is null
  and id=(public.task_app_current_member()).id for update;
 if not found then raise exception 'Profile session ended' using errcode='42501';end if;
 if jsonb_array_length(template_items)>0 then
  select array_agg((e->>'id')::uuid order by (e->>'id')::uuid) into template_ids from jsonb_array_elements(template_items) e;
  for chosen in select unnest(template_ids) as id loop perform pg_advisory_xact_lock(hashtextextended(chosen.id::text,113));end loop;
  perform 1 from public.task_templates where owner_id=own_id and id=any(template_ids) order by id for update;
  select count(*) into valid_count from public.task_templates t join jsonb_array_elements(template_items) e on t.id=(e->>'id')::uuid
   where t.owner_id=own_id and t.deleted_at is not null and t.updated_at=(e->>'version')::timestamptz;
  if valid_count<>cardinality(template_ids) then raise exception 'Bin selection changed' using errcode='P0012';end if;
  if operation='purge' then delete from public.task_templates where owner_id=own_id and id=any(template_ids) and deleted_at is not null;
  else update public.task_templates set deleted_at=null,deleted_by_member_id=null,deleted_by_name=null,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where owner_id=own_id and id=any(template_ids);end if;
 end if;
 select jsonb_agg(jsonb_build_object('kind',e->>'kind','id',e->>'id')) into result_items from jsonb_array_elements(selections) e;
 return jsonb_build_object('action',operation,'items',result_items);
end;$function$
;

-- Retained implementation from migrations001–014: task_app_completed
CREATE OR REPLACE FUNCTION public.task_app_legacy_completed(operation text, expected_count bigint DEFAULT NULL::bigint, expected_snapshot text DEFAULT NULL::text, confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare own_id uuid:=public.task_app_workspace_owner(); member public.account_members; target public.tasks;
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
$function$
;

-- Retained implementation from migrations001–014: task_app_save_template
CREATE OR REPLACE FUNCTION public.task_app_legacy_save_template(template_id uuid, expected_version timestamp with time zone, template_name text, template_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare member public.account_members;current_template public.task_templates;
  clean_name text:=regexp_replace(template_name,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  member:=public.task_app_current_member();
  if member.id is null then raise exception 'Choose your name' using errcode='42501';end if;
  perform 1 from public.account_members where id=member.id and owner_id=public.task_app_workspace_owner() and left_at is null for share;
  if not found then raise exception 'Profile session ended' using errcode='42501';end if;
  if template_id is null or clean_name is null or char_length(clean_name) not between 1 and 100 or not public.task_app_valid_template_items(template_items) then
    raise exception 'Invalid template' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(template_id::text,113));
  select * into current_template from public.task_templates where id=template_id and owner_id=public.task_app_workspace_owner() for update;
  if current_template.deleted_at is not null then raise exception 'Template is in Bin' using errcode='P0013';end if;
  if expected_version is null then
    if current_template.id is not null then
      if current_template.name<>clean_name or current_template.items<>template_items then raise exception 'Template changed' using errcode='P0013';end if;
    else
      if exists(select 1 from public.task_templates where id=template_id) then raise exception 'Template unavailable' using errcode='P0013';end if;
      insert into public.task_templates(id,owner_id,name,items) values(template_id,public.task_app_workspace_owner(),clean_name,template_items) returning * into current_template;
    end if;
  else
    if current_template.id is null or current_template.updated_at<>expected_version then raise exception 'Template changed' using errcode='P0013';end if;
    update public.task_templates set name=clean_name,items=template_items,
      updated_at=greatest(clock_timestamp(),current_template.updated_at+interval '1 microsecond')
      where id=template_id and owner_id=public.task_app_workspace_owner() returning * into current_template;
  end if;
  return jsonb_build_object('id',current_template.id,'name',current_template.name,'items',current_template.items,
    'created_at',current_template.created_at,'updated_at',current_template.updated_at);
end;$function$
;

-- Retained implementation from migrations001–014: task_app_remove_template
CREATE OR REPLACE FUNCTION public.task_app_legacy_remove_template(template_id uuid, expected_version timestamp with time zone, confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare member public.account_members;target public.task_templates;
begin
 member:=public.task_app_current_member();
 if member.id is null then raise exception 'Choose your name' using errcode='42501';end if;
 if template_id is null or expected_version is null or confirmed is distinct from true then raise exception 'Confirm template removal' using errcode='23514';end if;
 perform 1 from public.account_members where id=member.id and owner_id=public.task_app_workspace_owner() and left_at is null for share;
 if not found then raise exception 'Profile session ended' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(template_id::text,113));
 select * into target from public.task_templates where id=template_id and owner_id=public.task_app_workspace_owner() for update;
 if target.id is null or target.deleted_at is not null or target.updated_at<>expected_version then raise exception 'Template changed' using errcode='P0013';end if;
 update public.task_templates set deleted_at=clock_timestamp(),deleted_by_member_id=member.id,deleted_by_name=member.name,
  updated_at=greatest(clock_timestamp(),target.updated_at+interval '1 microsecond') where id=template_id and owner_id=public.task_app_workspace_owner() returning * into target;
 return jsonb_build_object('id',target.id,'updated_at',target.updated_at,'deleted_at',target.deleted_at);
end;$function$
;

-- Retained implementation from migrations001–014: task_app_deleted_templates
CREATE OR REPLACE FUNCTION public.task_app_legacy_deleted_templates()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if public.task_app_workspace_owner() is null or (public.task_app_current_member()).id is null then raise exception 'Choose your name' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'items',items,'created_at',created_at,
  'updated_at',updated_at,'deleted_at',deleted_at,'deleted_by_name',deleted_by_name) order by deleted_at desc,id)
  from public.task_templates where owner_id=public.task_app_workspace_owner() and deleted_at is not null),'[]'::jsonb);
end;$function$
;

-- Retained implementation from migrations001–014: task_app_member_history
CREATE OR REPLACE FUNCTION public.task_app_member_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare own_id uuid:=public.task_app_workspace_owner();member public.account_members;members jsonb;totals jsonb;entries jsonb;windows jsonb;
 current_time_value timestamptz:=statement_timestamp();local_day date:=(statement_timestamp() at time zone 'Asia/Kolkata')::date;
begin
 member:=public.task_app_current_member();
 if own_id is null or member.id is null then raise exception 'Choose your name' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by (id=member.id) desc,created_at,id),'[]'::jsonb)
  into members from public.account_members where owner_id=own_id and left_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('memberId',t.member_id,'year',t.completion_year,'count',t.completed_count) order by t.member_id,t.completion_year),'[]'::jsonb)
  into totals from public.member_completion_totals t join public.account_members m on m.owner_id=t.owner_id and m.id=t.member_id
  where t.owner_id=own_id and m.left_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'memberId',t.completed_by_member_id,'title',t.title,'notes',coalesce(t.notes,''),
  'category',c.name,'completedAt',t.completed_at,'expiresAt',expiry.ends_at) order by t.completed_at desc,t.id),'[]'::jsonb)
  into entries from public.tasks t join public.categories c on c.owner_id=t.owner_id and c.id=t.category_id
  join public.account_members m on m.owner_id=t.owner_id and m.id=t.completed_by_member_id
  cross join lateral(select public.task_app_history_expires(c.name,t.completed_at,t.due_date,t.weekdays) as ends_at) expiry
  where t.owner_id=own_id and m.left_at is null and t.status='completed' and t.deleted_at is null
   and t.completed_at<=current_time_value and expiry.ends_at>current_time_value
   and (t.available_at is null or t.available_at<=current_time_value);
 -- Scheduled Special Meetings override the weekly category for the whole account,
 -- even if the selected member has no completions. Consecutive windows merge in UI.
 with special as(
  select t.* from public.tasks t join public.categories c on c.owner_id=t.owner_id and c.id=t.category_id
  where t.owner_id=own_id and c.name='Special Meeting' and t.deleted_at is null
 ),scheduled as(
  select due_date as meeting_day from special where due_date is not null
  union
  select p.due_date from public.task_repeat_pending p join public.categories c
   on c.owner_id=p.owner_id and c.id=(p.payload->>'category_id')::uuid
   where p.owner_id=own_id and c.name='Special Meeting' and p.generated_at is null and not p.cancelled
  union
  select candidate::date from special s cross join generate_series(local_day-1,local_day+7,interval '1 day') candidate
   where s.repeat_rule='weekly' and s.due_date is not null and candidate::date>=s.due_date
    and extract(dow from candidate)::smallint=any(s.weekdays)
 ),late_completed as(
  select (public.task_app_history_expires('Special Meeting',completed_at,due_date,weekdays) at time zone 'Asia/Kolkata')::date-1 as meeting_day
  from special where status='completed' and completed_at<=current_time_value
 ),all_days as(select meeting_day from scheduled union select meeting_day from late_completed)
 select coalesce(jsonb_agg(jsonb_build_object('startsAt',meeting_day::timestamp at time zone 'Asia/Kolkata',
  'endsAt',(meeting_day+1+time '23:50') at time zone 'Asia/Kolkata') order by meeting_day),'[]'::jsonb)
  into windows from all_days where meeting_day is not null and ((meeting_day+1+time '23:50') at time zone 'Asia/Kolkata')>current_time_value;
 return jsonb_build_object('serverNow',current_time_value,'members',members,'totals',totals,'entries',entries,'specialWindows',windows);
end;$function$
;

-- Retained implementation from migrations001–014: task_app_rename_member
CREATE OR REPLACE FUNCTION public.task_app_legacy_rename_member(member_name text, previous_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare own_id uuid:=public.task_app_workspace_owner(); member public.account_members; clean_name text;
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
$function$
;

-- Retained implementation from migrations001–014: task_app_release_my_repeats
CREATE OR REPLACE FUNCTION public.task_app_release_my_repeats()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare own_id uuid:=public.task_app_workspace_owner();
begin
  if own_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return public.task_app_release_repeats(own_id,statement_timestamp());
end;
$function$
;

create function public.task_app_assign_occurrence() returns trigger language plpgsql security definer set search_path='' as $$
declare series_assignee uuid;
begin
 if new.series_id is not null then
  select assigned_to_member_id into series_assignee from public.task_series where owner_id=new.owner_id and id=new.series_id;
  if tg_op='INSERT' and new.occurrence_number>0 then new.assigned_to_member_id:=series_assignee;end if;
  if series_assignee is null and new.assigned_to_member_id is not null then
   update public.task_series set assigned_to_member_id=new.assigned_to_member_id where id=new.series_id and owner_id=new.owner_id;
  end if;
 end if;
 if new.assigned_to_member_id is not null and not exists(select 1 from public.account_members where owner_id=new.owner_id and id=new.assigned_to_member_id and auth_user_id is not null) then
 raise exception 'Assignee must belong to this workspace' using errcode='23514';end if;
 return new;
end;$$;
create trigger tasks_zz_assignment before insert or update on public.tasks for each row execute function public.task_app_assign_occurrence();

create function public.task_app_create_tasks(task_fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;f jsonb;t public.tasks;result jsonb:='[]'::jsonb;category_value text;
begin
 m:=public.task_app_require_role(true);
 if jsonb_typeof(task_fields) is distinct from 'array' or jsonb_array_length(task_fields) not between 1 and 20 then raise exception 'Invalid task batch' using errcode='23514';end if;
 for f in select value from jsonb_array_elements(task_fields) loop
 if jsonb_typeof(f) is distinct from 'object' or exists(select 1 from jsonb_object_keys(f)k where k not in ('title','notes','status','due_date','due_time','priority','category_id','weekdays','repeat_rule','assigned_to_member_id'))
 or f->>'status' is distinct from 'active' or not exists(select 1 from public.account_members where owner_id=m.owner_id and id=(f->>'assigned_to_member_id')::uuid and left_at is null and auth_user_id is not null) then
 raise exception 'Choose an active workspace assignee' using errcode='23514';end if;
 if category_value is not null and category_value is distinct from coalesce(f->>'category_id','') then raise exception 'One category per batch' using errcode='23514';end if;
 category_value:=coalesce(f->>'category_id','');
 insert into public.tasks(owner_id,title,notes,status,due_date,due_time,priority,category_id,weekdays,repeat_rule,assigned_to_member_id)
 values(m.owner_id,f->>'title',f->>'notes','active',(f->>'due_date')::date,(f->>'due_time')::time,f->>'priority',(f->>'category_id')::uuid,
 array(select jsonb_array_elements_text(f->'weekdays')::smallint),coalesce(f->>'repeat_rule','off'),(f->>'assigned_to_member_id')::uuid) returning * into t;
 result:=result||jsonb_build_array(to_jsonb(t));
 end loop;
 return result;
end;$$;

create or replace function public.task_app_mutate(task_id uuid,expected_version timestamptz,operation text,fields jsonb default null,new_status text default null,edit_scope text default 'this',expected_series_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;r jsonb;assignee uuid;
begin
 m:=public.task_app_require_role(operation is distinct from 'status');
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null for update;
 if t.id is null then return null;end if;
 if t.updated_at is distinct from expected_version then return jsonb_build_object('conflict',true);end if;
 if operation='status' then
  if t.assigned_to_member_id is distinct from m.id then raise exception 'Only the assigned member can complete or reopen' using errcode='P0403';end if;
 elsif operation='update' then
  assignee:=(fields->>'assigned_to_member_id')::uuid;
  if assignee is null or not exists(select 1 from public.account_members where owner_id=m.owner_id and id=assignee and left_at is null and auth_user_id is not null) then raise exception 'Choose an active assignee' using errcode='23514';end if;
  if assignee is distinct from t.assigned_to_member_id and t.status='completed' then raise exception 'The current assignee must reopen before reassignment' using errcode='P0409';end if;
  if fields->>'status' is distinct from t.status and (t.assigned_to_member_id is distinct from m.id or assignee is distinct from t.assigned_to_member_id) then
   raise exception 'Only current assignee can change status; reassign separately' using errcode='P0403';end if;
 end if;
 r:=public.task_app_legacy_mutate(task_id,expected_version,operation,fields-'assigned_to_member_id',new_status,edit_scope,expected_series_version);
 if r is null or coalesce(r->>'conflict','false')='true' then return r;end if;
 if operation='update' and assignee is distinct from t.assigned_to_member_id then
  update public.tasks set assigned_to_member_id=assignee where id=task_id and owner_id=m.owner_id;
 end if;
 select to_jsonb(t1)||jsonb_build_object('series_version',(select max(updated_at) from public.tasks where owner_id=m.owner_id and deleted_at is null and (series_id=t1.series_id or id=t1.id))) into r from public.tasks t1 where id=task_id and owner_id=m.owner_id;
 return r;
end;$$;

create function public.task_app_setup(operation text,category_name text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;n text;result public.categories;
begin
 m:=public.task_app_require_role();
 -- First verified membership can initialize the fixed baseline, including a
 -- Member on a workspace whose Owner has not opened tasks yet.
 insert into public.account_settings(owner_id,timezone) values(m.owner_id,'Asia/Kolkata') on conflict(owner_id) do nothing;
 if operation='category' then
  m:=public.task_app_require_role(true);n:=btrim(category_name);
  if n is null or char_length(n) not between 1 and 40 then raise exception 'Invalid category' using errcode='23514';end if;
  insert into public.categories(owner_id,name) values(m.owner_id,n) on conflict do nothing;
  select * into result from public.categories where owner_id=m.owner_id and lower(name)=lower(n);
  return jsonb_build_object('category',jsonb_build_object('id',result.id,'name',result.name));
 elsif operation='bootstrap' then
  foreach n in array array['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting','Woman''s Meeting'] loop
   insert into public.categories(owner_id,name) values(m.owner_id,n) on conflict do nothing;
  end loop;
 elsif operation<>'setup' then raise exception 'Invalid setup' using errcode='23514';end if;
 return jsonb_build_object('timezone','Asia/Kolkata');
end;$$;

create or replace function public.task_app_bin(operation text,selections jsonb,confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.task_app_require_role(true);return public.task_app_legacy_bin(operation,selections,confirmed);end;$$;
create or replace function public.task_app_bin_items(operation text,selections jsonb,confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.task_app_require_role(true);return public.task_app_legacy_bin_items(operation,selections,confirmed);end;$$;
create or replace function public.task_app_completed(operation text,expected_count bigint default null,expected_snapshot text default null,confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.task_app_require_role(true);return public.task_app_legacy_completed(operation,expected_count,expected_snapshot,confirmed);end;$$;
create or replace function public.task_app_save_template(template_id uuid,expected_version timestamptz,template_name text,template_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.task_app_require_role(true);return public.task_app_legacy_save_template(template_id,expected_version,template_name,template_items);end;$$;
create or replace function public.task_app_remove_template(template_id uuid,expected_version timestamptz,confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.task_app_require_role(true);return public.task_app_legacy_remove_template(template_id,expected_version,confirmed);end;$$;
create or replace function public.task_app_deleted_templates() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.task_app_require_role(true);return public.task_app_legacy_deleted_templates();end;$$;
create or replace function public.task_app_rename_member(member_name text,previous_name text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.task_app_require_role();return public.task_app_legacy_rename_member(member_name,previous_name);end;$$;
create or replace function public.task_app_leave_member() returns boolean language plpgsql security definer set search_path='' as $$
declare m public.account_members;
begin
 m:=public.task_app_require_role();
 if m.role='owner' then raise exception 'Transfer ownership before leaving' using errcode='P0409';end if;
 update public.account_members set left_at=statement_timestamp() where id=m.id;
 -- Leave preserves tasks/repeat assignments; managers can reassign unfinished
 -- work. Every device loses workspace access on its next checked request.
 update public.account_member_presence set active_until=statement_timestamp() where owner_id=m.owner_id and member_id=m.id;
 return true;
end;$$;

create or replace function public.task_app_presence(tab_id uuid,is_active boolean,client_sequence bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;s uuid:=nullif(auth.jwt()->>'session_id','')::uuid;previous public.account_member_presence;
begin
 m:=public.task_app_require_role();
 if tab_id is null or is_active is null or client_sequence is null or client_sequence not between 1 and 9007199254740991 then raise exception 'Invalid activity' using errcode='23514';end if;
 delete from public.account_member_presence where owner_id=m.owner_id and updated_at<statement_timestamp()-interval '1 day';
 select * into previous from public.account_member_presence p where p.owner_id=m.owner_id and p.session_id=s and p.tab_id=task_app_presence.tab_id;
 if found and previous.sequence_number>=client_sequence then return public.task_app_member_state();end if;
 if previous.tab_id is null and (select count(*) from public.account_member_presence where owner_id=m.owner_id and session_id=s)>=64 then raise exception 'Too many tabs' using errcode='23514';end if;
 insert into public.account_member_presence(owner_id,session_id,tab_id,member_id,sequence_number,active_until)
 values(m.owner_id,s,tab_id,m.id,client_sequence,statement_timestamp()+case when is_active then interval '65 seconds' else interval '0 seconds' end)
 on conflict on constraint account_member_presence_pkey do update set sequence_number=excluded.sequence_number,active_until=excluded.active_until,updated_at=statement_timestamp();
 if is_active or (previous.active_until>statement_timestamp()) then update public.account_members set last_seen_at=greatest(last_seen_at,statement_timestamp()) where id=m.id;end if;
 return public.task_app_member_state();
end;$$;

-- Invitations never use an admin Auth key or send email from SQL. The Owner gets
-- a shareable link; acceptance requires the exact invited, verified identity.
create function public.task_app_invite(invited_email text,invited_role text,replace_invitation uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;clean text:=lower(btrim(invited_email));token text;i public.workspace_invitations;
begin
 m:=public.task_app_require_role(false,true);
 if clean is null or clean !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(clean)>254 or invited_role is null or invited_role not in ('member','coordinator') then raise exception 'Invalid invitation' using errcode='23514';end if;
 if exists(select 1 from public.account_members a join auth.users u on u.id=a.auth_user_id where a.owner_id=m.owner_id and a.left_at is null and lower(u.email)=clean) then raise exception 'Already a member' using errcode='P0409';end if;
 if replace_invitation is not null then
  select * into i from public.workspace_invitations where id=replace_invitation and owner_id=m.owner_id and accepted_at is null and revoked_at is null for update;
  if not found or i.email<>clean then raise exception 'Invitation changed' using errcode='P0409';end if;
  update public.workspace_invitations set revoked_at=statement_timestamp() where id=i.id;
 elsif exists(select 1 from public.workspace_invitations where owner_id=m.owner_id and email=clean and accepted_at is null and revoked_at is null and expires_at>statement_timestamp()) then raise exception 'Invitation already pending' using errcode='P0409';end if;
 if (select count(*) from public.account_members where owner_id=m.owner_id and left_at is null)+(select count(*) from public.workspace_invitations where owner_id=m.owner_id and accepted_at is null and revoked_at is null and expires_at>statement_timestamp())>=10 then raise exception 'All ten places are reserved' using errcode='P0010';end if;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.workspace_invitations(owner_id,email,role,token_hash,invited_by) values(m.owner_id,clean,invited_role,encode(sha256(convert_to(token,'UTF8')),'hex'),m.id) returning * into i;
 return jsonb_build_object('token',token,'expires_at',i.expires_at,'id',i.id);
end;$$;
create function public.task_app_revoke_invitation(invitation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;
begin m:=public.task_app_require_role(false,true);
 update public.workspace_invitations set revoked_at=statement_timestamp() where id=invitation_id and owner_id=m.owner_id and accepted_at is null and revoked_at is null;
 if not found then raise exception 'Invitation changed' using errcode='P0409';end if;
 return public.task_app_member_state();end;$$;
create function public.task_app_accept_invitation(invitation_token text,member_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare user_value uuid:=public.task_app_verified_user();i public.workspace_invitations;m public.account_members;clean text:=btrim(regexp_replace(member_name,'[[:space:]]+',' ','g'));
begin
 if user_value is null then raise exception 'Verified sign in required' using errcode='42501';end if;
 if invitation_token is null or invitation_token !~ '^[a-f0-9]{64}$' or clean is null or char_length(clean) not between 1 and 50 or member_name ~ '[[:cntrl:]]' then raise exception 'Invalid invitation details' using errcode='23514';end if;
 select * into i from public.workspace_invitations where token_hash=encode(sha256(convert_to(invitation_token,'UTF8')),'hex');
 if i.id is null then raise exception 'Invitation unavailable' using errcode='P0409';end if;
 perform pg_advisory_xact_lock(hashtextextended(i.owner_id::text,163));
 -- One identity cannot race two different workspace invitations.
 perform pg_advisory_xact_lock(hashtextextended(user_value::text,164));
 select * into i from public.workspace_invitations where id=i.id for update;
 if not exists(select 1 from auth.users where id=user_value and lower(email)=i.email and email_confirmed_at is not null) then raise exception 'Sign in with the invited verified email' using errcode='P0403';end if;
 if i.accepted_at is not null then
  if i.accepted_by=user_value and exists(select 1 from public.account_members where auth_user_id=user_value and owner_id=i.owner_id and left_at is null) then return public.task_app_member_state();end if;
  raise exception 'Invitation already used' using errcode='P0409';end if;
 if i.revoked_at is not null or i.expires_at<=statement_timestamp() then raise exception 'Invitation expired or cancelled' using errcode='P0409';end if;
 if exists(select 1 from public.account_members where auth_user_id=user_value and left_at is null) then raise exception 'Already joined a workspace' using errcode='P0409';end if;
 if (select count(*) from public.account_members where owner_id=i.owner_id and left_at is null)>=10 then raise exception 'Workspace full' using errcode='P0010';end if;
 insert into public.account_members(owner_id,auth_user_id,name,role) values(i.owner_id,user_value,clean,i.role) returning * into m;
 update public.workspace_invitations set accepted_at=statement_timestamp(),accepted_by=user_value where id=i.id;
 return public.task_app_member_state();
end;$$;
create function public.task_app_change_role(member_id uuid,previous_role text,new_role text,confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.account_members;
begin m:=public.task_app_require_role(false,true);
 select * into t from public.account_members where id=member_id and owner_id=m.owner_id and left_at is null for update;
 if t.id is null or t.role='owner' or t.role is distinct from previous_role then raise exception 'Member role changed' using errcode='P0409';end if;
 if confirmed is distinct from true or new_role is null or new_role not in ('coordinator','member') then raise exception 'Confirm a valid role' using errcode='23514';end if;
 update public.account_members set role=new_role where id=t.id;return public.task_app_member_state();end;$$;
create function public.task_app_transfer_owner(member_id uuid,confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.account_members;
begin m:=public.task_app_require_role(false,true);
 select * into t from public.account_members where id=member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null for update;
 if confirmed is distinct from true or t.id is null or t.id=m.id then raise exception 'Confirm another active member' using errcode='23514';end if;
 update public.account_members set role='coordinator' where id=m.id;
 update public.account_members set role='owner' where id=t.id;
 return public.task_app_member_state();end;$$;

-- Remove all historical direct write grants, including column-level grants.
do $$declare item record;col record;
begin
 for item in select c.oid,c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in ('tasks','categories','account_settings','task_series','task_repeat_pending','account_members','account_member_sessions','account_member_presence','task_templates','member_task_completions','member_completion_totals') loop
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',item.relname);
 for col in select attname from pg_attribute where attrelid=item.oid and attnum>0 and not attisdropped loop
 execute format('revoke all (%I) on public.%I from public,anon,authenticated,service_role',col.attname,item.relname);end loop;
 end loop;
 for item in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('tasks','categories','account_settings','task_series','account_members','task_templates') loop
 execute format('drop policy %I on public.%I',item.policyname,item.tablename);end loop;
end;$$;
grant select on public.tasks,public.categories,public.account_settings,public.account_members,public.task_templates to authenticated;
create policy tasks_workspace_read on public.tasks for select to authenticated using(owner_id=public.task_app_workspace_owner());
create policy categories_workspace_read on public.categories for select to authenticated using(owner_id=public.task_app_workspace_owner());
create policy settings_workspace_read on public.account_settings for select to authenticated using(owner_id=public.task_app_workspace_owner());
-- Do not expose auth_user_id/email associations to team members through direct SELECT.
revoke select on public.account_members from authenticated;
create policy templates_workspace_read on public.task_templates for select to authenticated using(owner_id=public.task_app_workspace_owner() and deleted_at is null and (public.task_app_current_member()).role in ('owner','coordinator'));
drop policy task_app_receive_account_sync on realtime.messages;
create policy task_app_receive_account_sync on realtime.messages for select to authenticated using(extension='broadcast' and topic='task-account:'||public.task_app_workspace_owner()::text and realtime.topic()='task-account:'||public.task_app_workspace_owner()::text and public.task_app_can_receive_sync());
create trigger invitations_live_sync after insert or update or delete on public.workspace_invitations for each row execute function public.task_app_notify_sync('members');

-- Explicit allowlist: no exposed legacy routines, trigger helpers, bootstrap or
-- clock-injected maintenance. RLS helpers need execute but return only own scope.
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'task_app_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end;$$;
grant execute on function public.task_app_workspace_owner(),public.task_app_current_member(),public.task_app_can_receive_sync(),
 public.task_app_member_state(),public.task_app_presence(uuid,boolean,bigint),public.task_app_member_history(),public.task_app_release_my_repeats(),
 public.task_app_setup(text,text),public.task_app_create_tasks(jsonb),public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz),
 public.task_app_bin(text,jsonb,boolean),public.task_app_bin_items(text,jsonb,boolean),public.task_app_completed(text,bigint,text,boolean),
 public.task_app_save_template(uuid,timestamptz,text,jsonb),public.task_app_remove_template(uuid,timestamptz,boolean),public.task_app_deleted_templates(),
 public.task_app_rename_member(text,text),public.task_app_leave_member(),public.task_app_invite(text,text,uuid),public.task_app_revoke_invitation(uuid),
 public.task_app_accept_invitation(text,text),public.task_app_change_role(uuid,text,text,boolean),public.task_app_transfer_owner(uuid,boolean)
 to authenticated;
notify pgrst,'reload schema';
commit;
