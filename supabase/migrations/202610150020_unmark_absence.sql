-- LOCAL ONLY: reviewed self-return support. Do not apply to hosted Supabase
-- until separately approved. Existing task/profile UI outside attendance stays intact.
begin;
alter table public.account_member_absences
 add column cancelled_at timestamptz,
 add column previous_expires_at timestamptz,
 add constraint member_absence_return_interval check(
  (cancelled_at is null and previous_expires_at is null)
  or(cancelled_at is not null and previous_expires_at is not null
   and cancelled_at=expires_at and previous_expires_at>expires_at));
-- End the interval rather than deleting the row: historical 5 AM exemptions,
-- claimed-task foreign keys and the original scheduled expiry remain recorded.
create or replace function public.task_app_mark_absent(selected_category uuid,selected_date date default null,confirmed boolean default false)
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
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||c.id::text,0));
 -- Serialize the effective attendance time with the 5 AM assessment job.
 perform 1 from public.task_fine_candidates where owner_id=m.owner_id and member_id=m.id
  and category_id=c.id and not finalized order by task_id for update;
 if ends_at<=clock_timestamp() then raise exception 'This meeting period has ended' using errcode='P0409';end if;
 select * into a from public.account_member_absences where member_id=m.id and category_id=c.id and cancelled_at is null and expires_at>clock_timestamp() for update;
 if a.id is not null then
  if a.meeting_date is distinct from selected_date then raise exception 'Already absent for this category' using errcode='P0409';end if;
  return public.task_app_member_state();
 end if;
 insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,created_at,expires_at)
 values(m.owner_id,m.id,c.id,selected_date,clock_timestamp(),ends_at);
 return public.task_app_member_state();
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
 and public.task_app_absence_covers(helper_task,own_absence,clock_timestamp())) then
 raise exception 'You are absent for this meeting' using errcode='P0403';end if;
 insert into public.task_coverage_claims(task_id,absence_id,owner_id,original_member_id,taken_by_member_id)
 values(t.id,a.id,m.owner_id,a.member_id,m.id);
 -- Occurrence only: never change the task_series assignee or pending payload.
 update public.tasks set assigned_to_member_id=m.id where id=t.id and owner_id=m.owner_id returning * into t;
 return to_jsonb(t)||jsonb_build_object('coverage',null);
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
 'category',c.name,'meeting_date',a.meeting_date,'created_at',a.created_at,'expires_at',a.expires_at) order by a.created_at,a.id),'[]'::jsonb)
 from public.account_member_absences a join public.categories c on c.id=a.category_id and c.owner_id=a.owner_id
 join public.account_members absent_member on absent_member.id=a.member_id and absent_member.owner_id=a.owner_id and absent_member.left_at is null
 where a.owner_id=m.owner_id and a.cancelled_at is null and a.created_at<=at_time and a.expires_at>at_time));
end;$$;

create function public.task_app_unmark_absent(absence_id uuid,expected_expires_at timestamptz,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;a public.account_member_absences;ended_at timestamptz;
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
 if a.cancelled_at is not null or a.expires_at<=clock_timestamp() then return public.task_app_member_state();end if;
 -- A cron pass must not finalize an old absence snapshot while this return
 -- commits across a cutoff; it skips these locked rows and retries next pass.
 perform 1 from public.task_fine_candidates where owner_id=m.owner_id and member_id=m.id
  and category_id=a.category_id and not finalized order by task_id for update;
 ended_at:=greatest(clock_timestamp(),a.created_at+interval '1 microsecond');
 if ended_at>=a.expires_at then return public.task_app_member_state();end if;
 update public.account_member_absences set previous_expires_at=expires_at,expires_at=ended_at,cancelled_at=ended_at where id=a.id;
 -- No task reassignment: unclaimed work returns through current coverage rules;
 -- tasks already claimed stay with their teammate and future repeats stay intact.
 return public.task_app_member_state();
end;$$;

create trigger absences_return_members_sync after update of cancelled_at on public.account_member_absences
 for each row when(old.cancelled_at is distinct from new.cancelled_at)execute function public.task_app_notify_sync('members');
create trigger absences_return_tasks_sync after update of cancelled_at on public.account_member_absences
 for each row when(old.cancelled_at is distinct from new.cancelled_at)execute function public.task_app_notify_sync('tasks');
revoke all on function public.task_app_unmark_absent(uuid,timestamptz,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_unmark_absent(uuid,timestamptz,boolean)to authenticated;
notify pgrst,'reload schema';
commit;
