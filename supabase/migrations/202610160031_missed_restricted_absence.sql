-- New031, after reviewed030. No historical data, fine activation or jobs change.
-- Forced absence is deliberately separate from manual absence coverage/exemption.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if position('09:00'in pg_get_functiondef('public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure))=0 then raise exception 'Apply revised030 before031';end if;
end;$$;
alter table public.account_member_absences add column restriction_role text,
 add column restriction_actor_id uuid references public.account_members(id)on delete restrict,
 add constraint absence_restriction_provenance check((restriction_role is null and restriction_actor_id is null)or(restriction_role is not null and restriction_role in('owner','coordinator')and restriction_actor_id is not null));
create temporary table restriction_function_grants on commit drop as select oid,proowner,proacl from pg_proc where oid in(
 'public.task_app_emit_availability(public.tasks,timestamptz)'::regprocedure,'public.task_app_notifications()'::regprocedure,
 'public.task_app_absence_covers(public.tasks,public.account_member_absences,timestamptz)'::regprocedure,
 'public.task_app_member_state()'::regprocedure,'public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure,
 'public.task_app_finalize_fine(uuid,timestamptz)'::regprocedure,'public.task_app_take_task(uuid,timestamptz,uuid,boolean)'::regprocedure,
 'public.task_app_unmark_absent(uuid,timestamptz,boolean)'::regprocedure,'public.task_app_unmark_service_absent(uuid,timestamptz,text,boolean)'::regprocedure,
 'public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure);
create function public.task_app_restriction_covers(t public.tasks,a public.account_member_absences,at_time timestamptz)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare category_name text;end_day date;
begin
 if a.restriction_role is null or a.cancelled_at is not null or t.id is null or a.id is null
 or t.owner_id<>a.owner_id or t.assigned_to_member_id is distinct from a.member_id or t.category_id is distinct from a.category_id
 or t.status<>'active' or t.deleted_at is not null or at_time<a.created_at or at_time>=a.expires_at
 or(t.available_at is not null and t.available_at>at_time)then return false;end if;
 select name into category_name from public.categories where id=a.category_id and owner_id=a.owner_id;
 if category_name='Sunday Service'and not public.task_app_absence_service_covers(a,coalesce(t.sunday_service,'evening'),at_time)then return false;end if;
 if t.due_date is null then return true;end if;
 end_day:=(coalesce(a.previous_expires_at,a.expires_at)at time zone 'Asia/Kolkata')::date;
 if category_name='Special Meeting'then return t.due_date=a.meeting_date;end if;
 return t.due_date>=end_day-2 and t.due_date<end_day;
end;$$;
revoke all on function public.task_app_restriction_covers(public.tasks,public.account_member_absences,timestamptz)from public,anon,authenticated,service_role;
create or replace function public.task_app_absence_covers(t public.tasks,a public.account_member_absences,at_time timestamptz)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare category_name text;due_at timestamptz;anchor_at timestamptz;ends_at timestamptz;
begin
 if a.restriction_role is not null then return false;end if;
 if t.id is null or a.id is null or t.owner_id<>a.owner_id or t.assigned_to_member_id is distinct from a.member_id
 or t.category_id is distinct from a.category_id or t.status<>'active' or t.deleted_at is not null
 or (t.available_at is not null and t.available_at>at_time) or at_time<a.created_at or at_time>=a.expires_at then return false;end if;
 select name into category_name from public.categories where id=a.category_id and owner_id=a.owner_id;
 if category_name='Sunday Service'and not public.task_app_absence_service_covers(a,coalesce(t.sunday_service,'evening'),at_time)then return false;end if;
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

create or replace function public.task_app_member_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;items jsonb;invites jsonb;w public.task_workspaces;at_time timestamptz:=clock_timestamp();
begin
 if public.task_app_verified_user() is null then raise exception 'Verified sign in required' using errcode='42501';end if;
 m:=public.task_app_current_member();
 if m.id is null then return jsonb_build_object('current',null,'members','[]'::jsonb,'workspace',null,'invitations','[]'::jsonb,'server_now',at_time,'absences','[]'::jsonb);end if;
 select * into w from public.task_workspaces where owner_id=m.owner_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'created_at',u.created_at,'last_seen_at',u.last_seen_at,
 'active_until',(select max(p.active_until) from public.account_member_presence p join auth.sessions s on s.id=p.session_id and s.user_id=u.auth_user_id
 where p.owner_id=u.owner_id and p.member_id=u.id and p.active_until>at_time)) order by u.created_at,u.id),'[]'::jsonb)
 into items from public.account_members u where u.owner_id=m.owner_id and u.left_at is null and u.auth_user_id is not null;
 if m.role='owner' then
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'expires_at',i.expires_at) order by i.created_at),'[]'::jsonb) into invites
 from public.workspace_invitations i where i.owner_id=m.owner_id and i.accepted_at is null and i.revoked_at is null and i.expires_at>at_time;
 else invites:='[]'::jsonb;end if;
 return jsonb_build_object('current',(select e from jsonb_array_elements(items)e where e->>'id'=m.id::text),'members',items,
 'workspace',jsonb_build_object('id',w.id,'owner_id',w.owner_id,'name',w.name,'reserved_seats',(select count(*) from public.workspace_invitations i where i.owner_id=m.owner_id and i.accepted_at is null and i.revoked_at is null and i.expires_at>at_time)),
 'invitations',invites,'server_now',at_time,'absences',
 (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'member_id',a.member_id,'category_id',a.category_id,
 'restriction_role',a.restriction_role,'restriction_actor_id',a.restriction_actor_id,'category',c.name,'meeting_date',a.meeting_date,'sunday_service',a.sunday_service,'morning_returned_at',a.morning_returned_at,'evening_returned_at',a.evening_returned_at,'created_at',a.created_at,'expires_at',a.expires_at) order by a.created_at,a.id),'[]'::jsonb)
 from public.account_member_absences a join public.categories c on c.id=a.category_id and c.owner_id=a.owner_id
 join public.account_members absent_member on absent_member.id=a.member_id and absent_member.owner_id=a.owner_id and absent_member.left_at is null
 where a.owner_id=m.owner_id and a.cancelled_at is null and a.created_at<=at_time and a.expires_at>at_time and(c.name<>'Sunday Service'or public.task_app_absence_service_covers(a,'morning',at_time)or public.task_app_absence_service_covers(a,'evening',at_time))));
end;$$;

create or replace function public.task_app_legacy_before_coverage_mutate(task_id uuid,expected_version timestamptz,operation text,fields jsonb default null,new_status text default null,edit_scope text default 'this',expected_series_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;r jsonb;assignee uuid;
begin
 m:=public.task_app_require_role(operation is distinct from 'status');
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||t.assigned_to_member_id::text||':'||t.category_id::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null for update;
 if t.id is null then return null;end if;
 if t.updated_at is distinct from expected_version then return jsonb_build_object('conflict',true);end if;
 if (operation='status'or(operation='update'and fields->>'status' is distinct from t.status))and exists(select 1 from public.account_member_absences a where public.task_app_restriction_covers(t,a,clock_timestamp()))then raise exception 'Missed task restriction is active'using errcode='P0015';end if;
 if operation='status' then
  if t.status='completed' and t.missed_completion_role is not null then
   if new_status is distinct from 'active' or t.completed_by_member_id is distinct from m.id then
    raise exception 'Only the recorded completer can reopen missed work' using errcode='P0403';end if;
  elsif t.assigned_to_member_id is distinct from m.id then raise exception 'Only the assigned member can complete or reopen' using errcode='P0403';end if;
 elsif operation='update' then
  assignee:=(fields->>'assigned_to_member_id')::uuid;
  if assignee is null or not exists(select 1 from public.account_members where owner_id=m.owner_id and id=assignee and left_at is null and auth_user_id is not null) then raise exception 'Choose an active assignee' using errcode='23514';end if;
  if assignee is distinct from t.assigned_to_member_id and t.status='completed' then raise exception 'The current assignee must reopen before reassignment' using errcode='P0409';end if;
  if fields->>'status' is distinct from t.status and (
    assignee is distinct from t.assigned_to_member_id or
    case when t.status='completed' and t.missed_completion_role is not null
      then t.completed_by_member_id is distinct from m.id
      else t.assigned_to_member_id is distinct from m.id end) then
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

create or replace function public.task_app_unmark_absent(absence_id uuid,expected_expires_at timestamptz,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;a public.account_member_absences;ended_at timestamptz;category_name text;action_time timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true or expected_expires_at is null or not isfinite(expected_expires_at) then
  raise exception 'Confirm the absence return' using errcode='23514';end if;
 select * into a from public.account_member_absences where id=absence_id and owner_id=m.owner_id;
 if a.id is null then raise exception 'Absence changed; refresh first' using errcode='P0409';end if;
 if a.restriction_role is not null then raise exception 'Only managers can remove a Missed restriction'using errcode='P0015';end if;
 if a.member_id<>m.id then raise exception 'Only your own absence can be removed' using errcode='P0403';end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||a.category_id::text,0));
 select * into a from public.account_member_absences where id=absence_id and owner_id=m.owner_id and member_id=m.id for update;
 if a.id is null or coalesce(a.previous_expires_at,a.expires_at) is distinct from expected_expires_at then
  raise exception 'Absence changed; refresh first' using errcode='P0409';end if;
 select name into category_name from public.categories where id=a.category_id and owner_id=m.owner_id;
 if category_name='Sunday Service'then raise exception 'Choose Morning or Evening Service'using errcode='23514';end if;
 if a.cancelled_at is not null or a.expires_at<=clock_timestamp() then
  if not public.task_app_attendance_change_open(category_name,a.meeting_date,clock_timestamp()) then
   raise exception 'Attendance changes are closed' using errcode='P0012';end if;
  return public.task_app_member_state();end if;
 -- A cron pass must not finalize an old absence snapshot while this return
 -- commits across a cutoff; it skips these locked rows and retries next pass.
 perform 1 from public.task_fine_candidates where owner_id=m.owner_id and member_id=m.id
  and category_id=a.category_id and not finalized order by task_id for update;
 action_time:=clock_timestamp();
 if not public.task_app_attendance_change_open(category_name,a.meeting_date,action_time) then
  raise exception 'Attendance changes are closed' using errcode='P0012';end if;
 ended_at:=greatest(action_time,a.created_at+interval '1 microsecond');
 if ended_at>=a.expires_at then return public.task_app_member_state();end if;
 update public.account_member_absences set previous_expires_at=expires_at,expires_at=ended_at,cancelled_at=ended_at where id=a.id;
 -- No task reassignment: unclaimed work returns through current coverage rules;
 -- tasks already claimed stay with their teammate and future repeats stay intact.
 return public.task_app_member_state();
end;$$;

create or replace function public.task_app_unmark_service_absent(absence_id uuid,expected_expires_at timestamptz,selected_service text,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;a public.account_member_absences;category_name text;action_time timestamptz;ended_at timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true or expected_expires_at is null or not isfinite(expected_expires_at)
 or selected_service is null or selected_service not in('morning','evening')then raise exception 'Confirm the service return'using errcode='23514';end if;
 select * into a from public.account_member_absences where id=absence_id and owner_id=m.owner_id;
 if a.id is null then raise exception 'Absence changed; refresh first'using errcode='P0409';end if;
 if a.restriction_role is not null then raise exception 'Only managers can remove a Missed restriction'using errcode='P0015';end if;
 if a.member_id<>m.id then raise exception 'Only your own absence can be removed'using errcode='P0403';end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||a.category_id::text,0));
 select * into a from public.account_member_absences where id=absence_id and owner_id=m.owner_id and member_id=m.id for update;
 if a.id is null or coalesce(a.previous_expires_at,a.expires_at)is distinct from expected_expires_at then raise exception 'Absence changed; refresh first'using errcode='P0409';end if;
 select name into category_name from public.categories where id=a.category_id and owner_id=m.owner_id;
 if category_name is distinct from 'Sunday Service'or(a.sunday_service is not null and a.sunday_service<>selected_service)then raise exception 'Choose the matching Sunday service'using errcode='23514';end if;
 perform 1 from public.task_fine_candidates where owner_id=m.owner_id and member_id=m.id and category_id=a.category_id and not finalized order by task_id for update;
 action_time:=clock_timestamp();
 if not public.task_app_service_attendance_open(selected_service,action_time)then raise exception 'Attendance changes are closed'using errcode='P0012';end if;
 if a.cancelled_at is not null or not public.task_app_absence_service_covers(a,selected_service,action_time)then return public.task_app_member_state();end if;
 ended_at:=greatest(action_time,a.created_at+interval '1 microsecond');
 if ended_at>=a.expires_at then return public.task_app_member_state();end if;
 if a.sunday_service is null then
  -- Keep the legacy record and its claims; remove only this service's coverage.
  update public.account_member_absences set morning_returned_at=case when selected_service='morning'then ended_at else morning_returned_at end,
   evening_returned_at=case when selected_service='evening'then ended_at else evening_returned_at end where id=a.id;
 else
  update public.account_member_absences set previous_expires_at=expires_at,expires_at=ended_at,cancelled_at=ended_at where id=a.id;
 end if;
 return public.task_app_member_state();
end;$$;

create or replace function public.task_app_finalize_fine(candidate_id uuid,at_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c public.task_fine_candidates;activation timestamptz;
begin
 select enabled_at into activation from public.task_fine_configuration where singleton;
 if activation is null then return;end if;
 select * into c from public.task_fine_candidates where task_id=candidate_id for update;
 if c.task_id is null or c.finalized or c.cutoff_at is null or c.cutoff_at>at_time then return;end if;
 if c.cutoff_at>activation and c.created_at<c.cutoff_at and not c.completed and not c.deleted
 and c.member_id is not null and c.due_at<=c.cutoff_at
 and(c.available_at is null or c.available_at<=c.cutoff_at)
 and not exists(select 1 from public.account_member_absences a
  where a.restriction_role is null and a.owner_id=c.owner_id and a.member_id=c.member_id and a.category_id=c.category_id
  and a.created_at<c.cutoff_at and a.expires_at>c.cutoff_at
  and(c.category_name<>'Special Meeting'or a.meeting_date=c.scheduled_date)
  and(c.category_name<>'Sunday Service'or public.task_app_absence_service_covers(a,coalesce(c.sunday_service,'evening'),c.cutoff_at)))then
  insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)
  values(c.owner_id,c.task_id,c.title,c.category_name,c.member_id,coalesce(c.member_name,'Former member'),c.cutoff_at)
  on conflict(task_id)do nothing;
 end if;
 update public.task_fine_candidates set finalized=true where task_id=c.task_id;
end;$$;

create or replace function public.task_app_take_task(task_id uuid,expected_version timestamptz,absence_id uuid,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;helper_task public.tasks;a public.account_member_absences;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true then raise exception 'Confirm taking this task' using errcode='23514';end if;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id;
 if t.id is null then raise exception 'Task is no longer available' using errcode='P0409';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||t.category_id::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id for update;
 if t.deleted_at is null and t.assigned_to_member_id=m.id and exists(select 1 from public.task_coverage_claims c
 where c.task_id=t.id and c.absence_id=task_app_take_task.absence_id and c.taken_by_member_id=m.id) then
 return to_jsonb(t)||jsonb_build_object('coverage',null);end if;
 select * into a from public.account_member_absences where id=task_app_take_task.absence_id and owner_id=m.owner_id for update;
 if a.id is null or a.cancelled_at is not null or not exists(select 1 from public.account_members where id=a.member_id and owner_id=m.owner_id and left_at is null)
 or not public.task_app_absence_covers(t,a,clock_timestamp()) or t.updated_at is distinct from expected_version
 or exists(select 1 from public.task_coverage_claims c where c.task_id=t.id and c.absence_id=a.id) then
 raise exception 'This task or absence changed. Refresh first' using errcode='P0409';end if;
 if m.id=a.member_id then raise exception 'Another member must take your released task' using errcode='P0403';end if;
 helper_task:=t;helper_task.assigned_to_member_id:=m.id;
 if exists(select 1 from public.account_member_absences own_absence where own_absence.member_id=m.id
 and(public.task_app_absence_covers(helper_task,own_absence,clock_timestamp())or public.task_app_restriction_covers(helper_task,own_absence,clock_timestamp()))) then
 raise exception 'You are absent for this meeting' using errcode='P0403';end if;
 insert into public.task_coverage_claims(task_id,absence_id,owner_id,original_member_id,taken_by_member_id)
 values(t.id,a.id,m.owner_id,a.member_id,m.id);
 -- Occurrence only: never change the task_series assignee or pending payload.
 update public.tasks set assigned_to_member_id=m.id where id=t.id and owner_id=m.owner_id returning * into t;
 return to_jsonb(t)||jsonb_build_object('coverage',null);
end;$$;

create or replace function public.task_app_complete_missed(task_id uuid,expected_version timestamptz,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;assignee public.account_members;
 category_name text;at_time timestamptz;activation timestamptz;meeting_day date;ends_at timestamptz;service text;
begin
 m:=public.task_app_require_role(true);
 if confirmed is distinct from true or task_id is null or expected_version is null or not isfinite(expected_version) then
  raise exception 'Confirm missed completion first' using errcode='23514';end if;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is null then raise exception 'Task changed; refresh first' using errcode='P0409';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 -- Same attendance lock as Mark/Unmark; stabilize the current absence decision.
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||t.assigned_to_member_id::text||':'||t.category_id::text,0));
 perform 1 from public.task_fine_candidates c where c.task_id=t.id for update;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null for update;
 m:=public.task_app_require_role(true);
 at_time:=clock_timestamp();
 if t.id is null or t.updated_at is distinct from expected_version or t.status<>'active'
  or(t.available_at is not null and t.available_at>at_time) then
  raise exception 'Task changed; refresh first' using errcode='P0409';end if;
 if t.assigned_to_member_id is null or t.assigned_to_member_id=m.id then
  raise exception 'Use ordinary completion for your own task' using errcode='P0403';end if;
 select * into assignee from public.account_members where id=t.assigned_to_member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null;
 select name into category_name from public.categories where id=t.category_id and owner_id=m.owner_id;
 if assignee.id is null or category_name not in ('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting') or category_name is null then
  raise exception 'Choose a current assigned meeting task' using errcode='P0409';end if;
 if not public.task_app_missed_timing_open(t,category_name,at_time)then raise exception 'Missed completion is outside the scheduled date or meeting period'using errcode='P0014';end if;
 if exists(select 1 from public.account_member_absences a where a.owner_id=m.owner_id
  and public.task_app_absence_covers(t,a,at_time)) then
  raise exception 'This member marked absence; use Take task instead' using errcode='P0409';end if;
 select enabled_at into activation from public.task_fine_configuration where singleton;
 if activation is null then raise exception 'Fine setup unavailable; no completion saved' using errcode='P0409';end if;
 -- Insert before changing status: deadline assessment races converge on the
 -- existing unique task_id. Paid/cancelled/earlier fines are never overwritten.
 insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at,assessed_at)
 values(m.owner_id,t.id,t.title,category_name,assignee.id,assignee.name,at_time,at_time)
 on conflict on constraint task_fines_task_id_key do nothing;
 update public.tasks set status='completed',missed_completion_role=m.role where id=t.id and owner_id=m.owner_id returning * into t;
 -- The Missed window identifies the occurrence, even just after midnight.
 meeting_day:=(at_time at time zone 'Asia/Kolkata')::date;
 if (at_time at time zone 'Asia/Kolkata')::time<time '01:00'then meeting_day:=meeting_day-1;end if;
 ends_at:=(meeting_day+2)::timestamp at time zone 'Asia/Kolkata';
 service:=case when category_name='Sunday Service'then coalesce(t.sunday_service,'evening')else null end;
 insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,sunday_service,created_at,expires_at,restriction_role,restriction_actor_id)
 values(m.owner_id,assignee.id,t.category_id,case when category_name='Special Meeting'then meeting_day else null end,service,at_time,ends_at,m.role,m.id)
 on conflict(member_id,category_id,expires_at,(coalesce(sunday_service,'both')))do nothing;
 update public.task_fine_candidates c set finalized=true where c.task_id=t.id;
 -- Existing status triggers stamp the actual actor/time, queue just one future
 -- occurrence and add the actor's yearly credit in this same transaction.
 return to_jsonb(t)||jsonb_build_object('series_version',(select max(updated_at)from public.tasks
  where owner_id=m.owner_id and deleted_at is null and(series_id=t.series_id or id=t.id)));
end;$$;
create or replace function public.task_app_emit_availability(t public.tasks,at_time timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare a public.account_member_absences;m public.account_members;helper public.tasks;category text;started timestamptz;
begin
 if t.deleted_at is not null or t.status<>'active'or t.assigned_to_member_id is null or(t.available_at is not null and t.available_at>at_time)then return;end if;
 select started_at into started from public.task_notification_configuration where singleton;
 select name into category from public.categories where id=t.category_id and owner_id=t.owner_id;
 for a in select * from public.account_member_absences where owner_id=t.owner_id and member_id=t.assigned_to_member_id and category_id=t.category_id and created_at>=started and cancelled_at is null and expires_at>at_time loop
  if not public.task_app_absence_covers(t,a,at_time)or exists(select 1 from public.task_coverage_claims where task_id=t.id and absence_id=a.id)then continue;end if;
  for m in select * from public.account_members where owner_id=t.owner_id and id<>t.assigned_to_member_id and left_at is null and auth_user_id is not null order by id loop
   helper:=t;helper.assigned_to_member_id:=m.id;
   if exists(select 1 from public.account_member_absences oa where oa.owner_id=t.owner_id and (public.task_app_absence_covers(helper,oa,at_time)or public.task_app_restriction_covers(helper,oa,at_time)))then continue;end if;
   perform public.task_app_emit_notification(t.owner_id,m.id,'available:'||t.id||':'||a.id,'task_available',t.id,t.title,category,a.member_id,jsonb_build_object('absenceId',a.id),greatest(t.created_at,t.updated_at,a.created_at,coalesce(t.available_at,a.created_at)),true);
  end loop;
 end loop;
end;$$;

create or replace function public.task_app_notifications()returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;n public.task_notifications;t public.tasks;a public.account_member_absences;helper public.tasks;
 q public.task_reopen_requests;entries jsonb:='[]';requests jsonb;pref public.task_notification_preferences;
 take_allowed boolean;request_allowed boolean;taken_name text;actor_label text;at_time timestamptz:=clock_timestamp();
begin
 m:=public.task_app_require_role();perform public.task_app_catchup_notifications();perform public.task_app_refresh_reopen_requests(m.owner_id);
 select * into pref from public.task_notification_preferences where member_id=m.id and owner_id=m.owner_id;
 if(select count(*)from public.task_notifications where recipient_id=m.id and owner_id=m.owner_id)>10000
 or(select count(*)from public.task_reopen_requests where owner_id=m.owner_id and(requester_id=m.id or reviewer_id=m.id))>10000 then raise exception 'Inbox limit reached; clear messages first'using errcode='P0013';end if;
 for n in select * from public.task_notifications where owner_id=m.owner_id and recipient_id=m.id order by created_at desc,id desc loop
  select * into t from public.tasks where id=n.task_id and owner_id=m.owner_id and deleted_at is null;
  take_allowed:=false;request_allowed:=false;taken_name:=null;q:=null;
  if n.kind='task_available'then
   select am.name into taken_name from public.task_coverage_claims cl join public.account_members am on am.id=cl.taken_by_member_id and am.owner_id=cl.owner_id where cl.task_id=n.task_id and cl.absence_id=(n.payload->>'absenceId')::uuid;
   select * into a from public.account_member_absences where id=(n.payload->>'absenceId')::uuid and owner_id=m.owner_id and cancelled_at is null;
   take_allowed:=t.id is not null and a.id is not null and public.task_app_absence_covers(t,a,at_time)and taken_name is null and t.assigned_to_member_id<>m.id
    and exists(select 1 from public.account_members where id=t.assigned_to_member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null);
   if take_allowed then helper:=t;helper.assigned_to_member_id:=m.id;
    take_allowed:=not exists(select 1 from public.account_member_absences oa where oa.owner_id=m.owner_id and (public.task_app_absence_covers(helper,oa,at_time)or public.task_app_restriction_covers(helper,oa,at_time)));end if;
  elsif n.kind='missed'then
   select * into q from public.task_reopen_requests where owner_id=m.owner_id and task_id=n.task_id and completed_at=(n.payload->>'completedAt')::timestamptz and requester_id=m.id;
   request_allowed:=q.id is null and t.id is not null and t.status='completed'and t.missed_completion_role is not null and t.completed_at=(n.payload->>'completedAt')::timestamptz and t.assigned_to_member_id=m.id
    and exists(select 1 from public.account_members where id=t.completed_by_member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null);
  end if;
  select coalesce(am.name,n.actor_name)into actor_label from(select 1)x left join public.account_members am on am.id=n.actor_id and am.owner_id=n.owner_id;
  entries:=entries||jsonb_build_array(jsonb_build_object('id',n.id,'kind',n.kind,'taskId',n.task_id,'title',n.task_title,'category',n.category_name,'actorName',actor_label,'payload',n.payload,'createdAt',n.created_at,'readAt',n.read_at,
   'taskAvailable',t.id is not null and(t.available_at is null or t.available_at<=at_time),'canTake',coalesce(take_allowed,false),'takenBy',taken_name,'canRequest',coalesce(request_allowed,false),'requestId',q.id,'requestStatus',q.status));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'taskId',r.task_id,'title',r.task_title,'requesterId',r.requester_id,'requesterName',sender.name,'reviewerId',r.reviewer_id,'reviewerName',reviewer.name,'completedAt',r.completed_at,'reason',r.reason,'status',r.status,'createdAt',r.created_at,'version',r.updated_at,'unavailableReason',r.unavailable_reason,'canReview',r.status='pending'and r.reviewer_id=m.id)order by r.created_at desc,r.id desc),'[]')into requests
 from public.task_reopen_requests r join public.account_members sender on sender.id=r.requester_id and sender.owner_id=r.owner_id join public.account_members reviewer on reviewer.id=r.reviewer_id and reviewer.owner_id=r.owner_id
 where r.owner_id=m.owner_id and(r.requester_id=m.id or r.reviewer_id=m.id);
 return jsonb_build_object('serverNow',at_time,'currentId',m.id,'entries',entries,'requests',requests,'preferences',jsonb_build_object('availability',pref.availability,'coverageUpdates',pref.coverage_updates,'reassignments',pref.reassignments));
end;$$;

create function public.task_app_remove_restriction(absence_id uuid,expected_expires_at timestamptz,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;a public.account_member_absences;ended_at timestamptz;
begin
 m:=public.task_app_require_role(true);
 if confirmed is distinct from true or absence_id is null or expected_expires_at is null or not isfinite(expected_expires_at)then raise exception 'Confirm restriction removal'using errcode='23514';end if;
 select * into a from public.account_member_absences where id=absence_id and owner_id=m.owner_id;
 if a.id is null then raise exception 'Restriction changed; refresh first'using errcode='P0409';end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||a.member_id::text||':'||a.category_id::text,0));
 select * into a from public.account_member_absences where id=absence_id and owner_id=m.owner_id for update;
 if a.restriction_role is null or coalesce(a.previous_expires_at,a.expires_at)is distinct from expected_expires_at then raise exception 'Restriction changed; refresh first'using errcode='P0409';end if;
 if a.cancelled_at is not null or a.expires_at<=clock_timestamp()then return public.task_app_member_state();end if;
 ended_at:=greatest(clock_timestamp(),a.created_at+interval '1 microsecond');
 if ended_at>=a.expires_at then return public.task_app_member_state();end if;
 update public.account_member_absences set previous_expires_at=expires_at,expires_at=ended_at,cancelled_at=ended_at where id=a.id;
 -- No task/fine/claim/repeat mutation: assignment and fine history stay intact.
 return public.task_app_member_state();
end;$$;
revoke all on function public.task_app_remove_restriction(uuid,timestamptz,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_remove_restriction(uuid,timestamptz,boolean)to authenticated;
do $$begin
 if exists(select 1 from restriction_function_grants g join pg_proc p on p.oid=g.oid where p.proowner is distinct from g.proowner or p.proacl is distinct from g.proacl)then raise exception 'Existing privileges changed';end if;
end;$$;
notify pgrst,'reload schema';commit;
