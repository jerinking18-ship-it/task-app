-- Local reviewed service attendance addition. Apply ONCE after coordinated approval.
-- Legacy Sunday marks remain both-service records; no absences/claims are deleted.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.account_member_absences,public.task_fine_candidates in share row exclusive mode;
alter table public.account_member_absences add column sunday_service text check(sunday_service in('morning','evening')),
 add column morning_returned_at timestamptz,add column evening_returned_at timestamptz,
 add constraint absence_return_scope check(sunday_service is null or(morning_returned_at is null and evening_returned_at is null)),
 add constraint absence_morning_return check(morning_returned_at is null or(morning_returned_at>=created_at and morning_returned_at<expires_at)),
 add constraint absence_evening_return check(evening_returned_at is null or(evening_returned_at>=created_at and evening_returned_at<expires_at));
alter table public.account_member_absences drop constraint account_member_absences_member_id_category_id_expires_at_key;
create unique index member_absence_service_expiry on public.account_member_absences(member_id,category_id,expires_at,coalesce(sunday_service,'both'));
create temporary table service_attendance_grants on commit drop as select oid,proowner,proacl from pg_proc where oid in(
 'public.task_app_mark_absent(uuid,date,boolean)'::regprocedure,'public.task_app_unmark_absent(uuid,timestamptz,boolean)'::regprocedure,
 'public.task_app_member_state()'::regprocedure,'public.task_app_absence_covers(public.tasks,public.account_member_absences,timestamptz)'::regprocedure,
 'public.task_app_finalize_fine(uuid,timestamptz)'::regprocedure,'public.task_app_track_fine(public.tasks)'::regprocedure);

-- Historical coverage is evaluated at the supplied private assessment time.
create function public.task_app_absence_service_covers(a public.account_member_absences,service text,at_time timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(service in('morning','evening')and a.created_at<=at_time and at_time<a.expires_at
 and(case when a.sunday_service is not null then a.sunday_service=service
 when service='morning'then a.morning_returned_at is null or at_time<a.morning_returned_at
 else a.evening_returned_at is null or at_time<a.evening_returned_at end),false);
$$;
create function public.task_app_service_attendance_open(service text,at_time timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(isfinite(at_time)and extract(dow from at_time at time zone 'Asia/Kolkata')=0 and
 case service when 'morning'then(at_time at time zone 'Asia/Kolkata')::time>=time '00:00'and(at_time at time zone 'Asia/Kolkata')::time<time '11:00'
 when 'evening'then(at_time at time zone 'Asia/Kolkata')::time>=time '13:00'and(at_time at time zone 'Asia/Kolkata')::time<time '21:00'else false end,false);
$$;
revoke all on function public.task_app_absence_service_covers(public.account_member_absences,text,timestamptz),
 public.task_app_service_attendance_open(text,timestamptz)from public,anon,authenticated,service_role;
create or replace function public.task_app_absence_covers(t public.tasks,a public.account_member_absences,at_time timestamptz)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare category_name text;due_at timestamptz;anchor_at timestamptz;ends_at timestamptz;
begin
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
 'category',c.name,'meeting_date',a.meeting_date,'sunday_service',a.sunday_service,'morning_returned_at',a.morning_returned_at,'evening_returned_at',a.evening_returned_at,'created_at',a.created_at,'expires_at',a.expires_at) order by a.created_at,a.id),'[]'::jsonb)
 from public.account_member_absences a join public.categories c on c.id=a.category_id and c.owner_id=a.owner_id
 join public.account_members absent_member on absent_member.id=a.member_id and absent_member.owner_id=a.owner_id and absent_member.left_at is null
 where a.owner_id=m.owner_id and a.cancelled_at is null and a.created_at<=at_time and a.expires_at>at_time and(c.name<>'Sunday Service'or public.task_app_absence_service_covers(a,'morning',at_time)or public.task_app_absence_service_covers(a,'evening',at_time))));
end;$$;
create or replace function public.task_app_mark_absent(selected_category uuid,selected_date date default null,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;c public.categories;a public.account_member_absences;ends_at timestamptz;action_time timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true then raise exception 'Confirm absence first' using errcode='23514';end if;
 select * into c from public.categories where id=selected_category and owner_id=m.owner_id;
 if c.id is null or c.name not in ('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting') then
 raise exception 'Choose a meeting category' using errcode='23514';end if;
 if c.name='Sunday Service'then raise exception 'Choose Morning or Evening Service'using errcode='23514';end if;
 if c.name='Special Meeting' then
  if selected_date is null or selected_date<date '0001-01-01' or selected_date>date '9999-12-30' then raise exception 'Choose a supported Special Meeting date' using errcode='23514';end if;
  ends_at:=((selected_date+2)+time '00:00') at time zone 'Asia/Kolkata';
 else
  if selected_date is not null then raise exception 'Only Special Meeting uses a selected date' using errcode='23514';end if;
  ends_at:=public.task_app_history_expires(c.name,statement_timestamp(),null,'{}');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||c.id::text,0));
 -- Serialize the effective attendance time with the 1 AM assessment job.
 perform 1 from public.task_fine_candidates where owner_id=m.owner_id and member_id=m.id
  and category_id=c.id and not finalized order by task_id for update;
 select * into a from public.account_member_absences where member_id=m.id and category_id=c.id and cancelled_at is null and expires_at>clock_timestamp() for update;
 action_time:=clock_timestamp();
 if not public.task_app_attendance_change_open(c.name,selected_date,action_time) then
  raise exception 'Attendance changes are closed' using errcode='P0012';end if;
 if ends_at<=action_time then raise exception 'This meeting period has ended' using errcode='P0409';end if;
 if a.id is not null then
  if a.meeting_date is distinct from selected_date then raise exception 'Already absent for this category' using errcode='P0409';end if;
  return public.task_app_member_state();
 end if;
 insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,created_at,expires_at)
 values(m.owner_id,m.id,c.id,selected_date,action_time,ends_at);
 return public.task_app_member_state();
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

create function public.task_app_mark_service_absent(selected_category uuid,selected_service text,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;c public.categories;a public.account_member_absences;ends_at timestamptz;action_time timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true or selected_service is null or selected_service not in('morning','evening')then
  raise exception 'Confirm a Sunday service absence'using errcode='23514';end if;
 select * into c from public.categories where id=selected_category and owner_id=m.owner_id;
 if c.id is null or c.name<>'Sunday Service'then raise exception 'Choose Sunday Service'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||c.id::text,0));
 -- Match Take task's absence-before-candidate row lock order.
 perform 1 from public.account_member_absences where member_id=m.id and category_id=c.id order by id for update;
 perform 1 from public.task_fine_candidates where owner_id=m.owner_id and member_id=m.id and category_id=c.id and not finalized order by task_id for update;
 action_time:=clock_timestamp();
 if not public.task_app_service_attendance_open(selected_service,action_time)then raise exception 'Attendance changes are closed'using errcode='P0012';end if;
 ends_at:=public.task_app_history_expires(c.name,action_time,null,'{}');
 select * into a from public.account_member_absences absence_row where absence_row.member_id=m.id and absence_row.category_id=c.id and absence_row.cancelled_at is null
 and public.task_app_absence_service_covers(absence_row,selected_service,action_time);
 if a.id is not null then return public.task_app_member_state();end if;
 insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,created_at,expires_at,sunday_service)
 values(m.owner_id,m.id,c.id,null,action_time,ends_at,selected_service);
 return public.task_app_member_state();
end;$$;
create function public.task_app_unmark_service_absent(absence_id uuid,expected_expires_at timestamptz,selected_service text,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;a public.account_member_absences;category_name text;action_time timestamptz;ended_at timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true or expected_expires_at is null or not isfinite(expected_expires_at)
 or selected_service is null or selected_service not in('morning','evening')then raise exception 'Confirm the service return'using errcode='23514';end if;
 select * into a from public.account_member_absences where id=absence_id and owner_id=m.owner_id;
 if a.id is null then raise exception 'Absence changed; refresh first'using errcode='P0409';end if;
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
revoke all on function public.task_app_mark_service_absent(uuid,text,boolean),public.task_app_unmark_service_absent(uuid,timestamptz,text,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_mark_service_absent(uuid,text,boolean),public.task_app_unmark_service_absent(uuid,timestamptz,text,boolean)to authenticated;

-- Snapshot service with the pre-cutoff candidate, including candidates that
-- outlive their tasks. No issued fines are recomputed or changed.
alter table public.task_fine_candidates add column sunday_service text check(sunday_service in('morning','evening'));
update public.task_fine_candidates c set sunday_service=coalesce((select t.sunday_service from public.tasks t where t.id=c.task_id and t.owner_id=c.owner_id),'evening')where c.category_name='Sunday Service';
create or replace function public.task_app_track_fine(t public.tasks)
returns void language plpgsql security definer set search_path='' as $$
declare category_name text;member_name text;activation timestamptz;due_at timestamptz;cutoff_at timestamptz;
begin
 select enabled_at into activation from public.task_fine_configuration where singleton;
 if activation is null then return;end if;
 select name into category_name from public.categories where owner_id=t.owner_id and id=t.category_id;
 select name into member_name from public.account_members where owner_id=t.owner_id and id=t.assigned_to_member_id;
 cutoff_at:=public.task_app_fine_cutoff(category_name,t.due_date,t.due_time);
 due_at:=case when t.due_date is null then null when t.due_time is null then(t.due_date+1)::timestamp at time zone 'Asia/Kolkata'else(t.due_date+t.due_time)at time zone 'Asia/Kolkata'end;
 insert into public.task_fine_candidates(owner_id,task_id,title,category_id,category_name,member_id,member_name,scheduled_date,due_at,cutoff_at,available_at,completed,deleted,created_at,finalized,sunday_service)
 values(t.owner_id,t.id,t.title,t.category_id,coalesce(category_name,''),t.assigned_to_member_id,member_name,t.due_date,due_at,cutoff_at,t.available_at,t.status='completed',t.deleted_at is not null,t.created_at,coalesce(cutoff_at<=greatest(activation,statement_timestamp()),false),case when category_name='Sunday Service'then coalesce(t.sunday_service,'evening')else null end)
 on conflict(task_id)do update set title=excluded.title,category_id=excluded.category_id,category_name=excluded.category_name,
 member_id=excluded.member_id,member_name=excluded.member_name,scheduled_date=excluded.scheduled_date,due_at=excluded.due_at,cutoff_at=excluded.cutoff_at,
 available_at=excluded.available_at,completed=excluded.completed,deleted=excluded.deleted,finalized=excluded.finalized,sunday_service=excluded.sunday_service
 where not public.task_fine_candidates.finalized
 or(excluded.cutoff_at>statement_timestamp()and excluded.cutoff_at is distinct from public.task_fine_candidates.cutoff_at
 and not exists(select 1 from public.task_fines f where f.task_id=excluded.task_id));
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
  where a.owner_id=c.owner_id and a.member_id=c.member_id and a.category_id=c.category_id
  and a.created_at<c.cutoff_at and a.expires_at>c.cutoff_at
  and(c.category_name<>'Special Meeting'or a.meeting_date=c.scheduled_date)
  and(c.category_name<>'Sunday Service'or public.task_app_absence_service_covers(a,coalesce(c.sunday_service,'evening'),c.cutoff_at)))then
  insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)
  values(c.owner_id,c.task_id,c.title,c.category_name,c.member_id,coalesce(c.member_name,'Former member'),c.cutoff_at)
  on conflict(task_id)do nothing;
 end if;
 update public.task_fine_candidates set finalized=true where task_id=c.task_id;
end;$$;
do $$begin
 if exists(select 1 from service_attendance_grants g join pg_proc p on p.oid=g.oid where p.proowner is distinct from g.proowner or p.proacl is distinct from g.proacl)then raise exception 'Existing function privileges changed';end if;
end;$$;
notify pgrst,'reload schema';
commit;
