-- Additive category attendance and occurrence-only team coverage. Apply once.
begin;
create table public.account_member_absences (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.task_workspaces(owner_id) on delete cascade,
 member_id uuid not null references public.account_members(id),
 category_id uuid not null,
 meeting_date date,
 created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null,
 foreign key(owner_id,category_id) references public.categories(owner_id,id) on delete cascade,
 unique(member_id,category_id,expires_at), check(expires_at>created_at)
);
create index member_absence_active on public.account_member_absences(owner_id,member_id,category_id,expires_at);
create table public.task_coverage_claims (
 task_id uuid not null references public.tasks(id) on delete cascade,
 absence_id uuid not null references public.account_member_absences(id) on delete cascade,
 owner_id uuid not null references public.task_workspaces(owner_id) on delete cascade,
 original_member_id uuid not null references public.account_members(id),
 taken_by_member_id uuid not null references public.account_members(id),
 taken_at timestamptz not null default statement_timestamp(),
 primary key(task_id,absence_id), check(original_member_id<>taken_by_member_id)
);
alter table public.account_member_absences enable row level security;
alter table public.task_coverage_claims enable row level security;
revoke all on public.account_member_absences,public.task_coverage_claims from public,anon,authenticated,service_role;

-- Private helper: category visibility and occurrence scheduling match the app.
create function public.task_app_absence_covers(t public.tasks,a public.account_member_absences,at_time timestamptz)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare category_name text;due_at timestamptz;anchor_at timestamptz;ends_at timestamptz;
begin
 if t.id is null or a.id is null or t.owner_id<>a.owner_id or t.assigned_to_member_id is distinct from a.member_id
 or t.category_id is distinct from a.category_id or t.status<>'active' or t.deleted_at is not null
 or (t.available_at is not null and t.available_at>at_time) or at_time<a.created_at or at_time>=a.expires_at then return false;end if;
 select name into category_name from public.categories where id=a.category_id and owner_id=a.owner_id;
 if category_name='Special Meeting' and t.due_date is not null and t.due_date is distinct from a.meeting_date then return false;end if;
 if t.due_date is null then return true;end if;
 due_at:=case when t.due_time is null then (t.due_date+1)::timestamp at time zone 'Asia/Kolkata'
 else (t.due_date+t.due_time) at time zone 'Asia/Kolkata' end;
 if due_at>a.expires_at then return false;end if;
 if due_at>at_time then return true;end if;
 anchor_at:=greatest(due_at,t.created_at);
 ends_at:=public.task_app_history_expires(category_name,
  anchor_at-case when anchor_at=due_at then interval '1 microsecond' else interval '0' end,t.due_date,t.weekdays);
 return ends_at is not null and ends_at>at_time;
end;$$;

create function public.task_app_available_coverage() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare own uuid:=public.task_app_workspace_owner();
begin
 if own is null then raise exception 'Verified workspace membership required' using errcode='P0403';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('task_id',t.id,'version',t.updated_at,'absence_id',a.id,
 'member_id',m.id,'member_name',m.name,'expires_at',a.expires_at) order by t.id),'[]'::jsonb)
 from public.tasks t join public.account_member_absences a on a.owner_id=t.owner_id and a.member_id=t.assigned_to_member_id and a.category_id=t.category_id
 join public.account_members m on m.id=a.member_id and m.owner_id=a.owner_id and m.left_at is null
 where t.owner_id=own and a.expires_at>statement_timestamp() and public.task_app_absence_covers(t,a,statement_timestamp())
 and not exists(select 1 from public.task_coverage_claims c where c.task_id=t.id and c.absence_id=a.id));
end;$$;

create function public.task_app_mark_absent(selected_category uuid,selected_date date default null,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;c public.categories;a public.account_member_absences;ends_at timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true then raise exception 'Confirm absence first' using errcode='23514';end if;
 select * into c from public.categories where id=selected_category and owner_id=m.owner_id;
 if c.id is null or c.name not in ('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting','Woman''s Meeting') then
 raise exception 'Choose a meeting category' using errcode='23514';end if;
 if c.name='Special Meeting' then
  if selected_date is null or selected_date<date '0001-01-01' or selected_date>date '9999-12-30' then raise exception 'Choose a supported Special Meeting date' using errcode='23514';end if;
  ends_at:=((selected_date+1)+time '23:50') at time zone 'Asia/Kolkata';
 else
  if selected_date is not null then raise exception 'Only Special Meeting uses a selected date' using errcode='23514';end if;
  ends_at:=public.task_app_history_expires(c.name,statement_timestamp(),null,'{}');
 end if;
 if ends_at<=statement_timestamp() then raise exception 'This meeting period has ended' using errcode='P0409';end if;
 select * into a from public.account_member_absences where member_id=m.id and category_id=c.id and expires_at>statement_timestamp() for update;
 if a.id is not null then
  if a.meeting_date is distinct from selected_date then raise exception 'Already absent for this category' using errcode='P0409';end if;
  return public.task_app_member_state();
 end if;
 insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,expires_at)
 values(m.owner_id,m.id,c.id,selected_date,ends_at);
 return public.task_app_member_state();
end;$$;

create function public.task_app_take_task(task_id uuid,expected_version timestamptz,absence_id uuid,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;helper_task public.tasks;a public.account_member_absences;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true then raise exception 'Confirm taking this task' using errcode='23514';end if;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id;
 if t.id is null then raise exception 'Task is no longer available' using errcode='P0409';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id for update;
 if t.deleted_at is null and t.assigned_to_member_id=m.id and exists(select 1 from public.task_coverage_claims c
 where c.task_id=t.id and c.absence_id=task_app_take_task.absence_id and c.taken_by_member_id=m.id) then
 return to_jsonb(t)||jsonb_build_object('coverage',null);end if;
 select * into a from public.account_member_absences where id=task_app_take_task.absence_id and owner_id=m.owner_id;
 if a.id is null or not exists(select 1 from public.account_members where id=a.member_id and owner_id=m.owner_id and left_at is null)
 or not public.task_app_absence_covers(t,a,statement_timestamp()) or t.updated_at is distinct from expected_version
 or exists(select 1 from public.task_coverage_claims c where c.task_id=t.id and c.absence_id=a.id) then
 raise exception 'This task or absence changed. Refresh first' using errcode='P0409';end if;
 if m.id=a.member_id then raise exception 'Another member must take your released task' using errcode='P0403';end if;
 helper_task:=t;helper_task.assigned_to_member_id:=m.id;
 if exists(select 1 from public.account_member_absences own_absence where own_absence.member_id=m.id
 and public.task_app_absence_covers(helper_task,own_absence,statement_timestamp())) then
 raise exception 'You are absent for this meeting' using errcode='P0403';end if;
 insert into public.task_coverage_claims(task_id,absence_id,owner_id,original_member_id,taken_by_member_id)
 values(t.id,a.id,m.owner_id,a.member_id,m.id);
 -- Occurrence only: never change the task_series assignee or pending payload.
 update public.tasks set assigned_to_member_id=m.id where id=t.id and owner_id=m.owner_id returning * into t;
 return to_jsonb(t)||jsonb_build_object('coverage',null);
end;$$;

-- A released occurrence must be taken before completion, even by its original
-- assignee. Keep every existing workspace/role/version check in the old wrapper.
alter function public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) rename to task_app_legacy_before_coverage_mutate;
revoke all on function public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
create function public.task_app_mutate(task_id uuid,expected_version timestamptz,operation text,fields jsonb default null,new_status text default null,edit_scope text default 'this',expected_series_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;
begin
 m:=public.task_app_require_role(operation is distinct from 'status');
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is not null and (operation='status' or (operation='update' and fields->>'status' is distinct from t.status))
 and exists(select 1 from public.account_member_absences a where a.owner_id=m.owner_id and public.task_app_absence_covers(t,a,statement_timestamp())
 and not exists(select 1 from public.task_coverage_claims c where c.task_id=t.id and c.absence_id=a.id)) then
 raise exception 'This task is available for a teammate to take' using errcode='P0403';end if;
 return public.task_app_legacy_before_coverage_mutate(task_id,expected_version,operation,fields,new_status,edit_scope,expected_series_version);
end;$$;

create trigger absences_members_sync after insert on public.account_member_absences for each row execute function public.task_app_notify_sync('members');
create trigger absences_tasks_sync after insert on public.account_member_absences for each row execute function public.task_app_notify_sync('tasks');

revoke all on function public.task_app_absence_covers(public.tasks,public.account_member_absences,timestamptz),
 public.task_app_available_coverage(),public.task_app_mark_absent(uuid,date,boolean),public.task_app_take_task(uuid,timestamptz,uuid,boolean),
 public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.task_app_available_coverage(),public.task_app_mark_absent(uuid,date,boolean),
 public.task_app_take_task(uuid,timestamptz,uuid,boolean),public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz) to authenticated;
-- The updated member-state definition is appended below before COMMIT.

create or replace function public.task_app_member_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;items jsonb;invites jsonb;w public.task_workspaces;
begin
 if public.task_app_verified_user() is null then raise exception 'Verified sign in required' using errcode='42501';end if;
 m:=public.task_app_current_member();
 if m.id is null then return jsonb_build_object('current',null,'members','[]'::jsonb,'workspace',null,'invitations','[]'::jsonb,'server_now',statement_timestamp(),'absences','[]'::jsonb);end if;
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
 'invitations',invites,'server_now',statement_timestamp(),'absences',
 (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'member_id',a.member_id,'category_id',a.category_id,
 'category',c.name,'meeting_date',a.meeting_date,'created_at',a.created_at,'expires_at',a.expires_at) order by a.created_at,a.id),'[]'::jsonb)
 from public.account_member_absences a join public.categories c on c.id=a.category_id and c.owner_id=a.owner_id
 join public.account_members absent_member on absent_member.id=a.member_id and absent_member.owner_id=a.owner_id and absent_member.left_at is null
 where a.owner_id=m.owner_id and a.created_at<=statement_timestamp() and a.expires_at>statement_timestamp()));
end;$$;
notify pgrst,'reload schema';
commit;
