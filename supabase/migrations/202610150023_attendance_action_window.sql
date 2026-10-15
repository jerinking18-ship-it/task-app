-- Local reviewed attendance-action window. Apply once with the matching client.
-- Only Mark/Unmark are limited to the meeting day [00:00,21:00) India time.
-- Existing absence expiries, tasks, claims, fines and yearly totals are untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.task_app_attendance_change_open(text,date,timestamptz)') is not null then
  raise exception 'Attendance action window023 is already installed or needs review';end if;
 if position('01:00' in pg_get_functiondef('public.task_app_fine_cutoff(text,date,time)'::regprocedure))=0 then
  raise exception 'Install the reviewed exact meeting windows022 first';end if;
end;$$;
create temporary table attendance_window_grants on commit drop as select oid,proowner,proacl from pg_proc where oid in(
 'public.task_app_mark_absent(uuid,date,boolean)'::regprocedure,
 'public.task_app_unmark_absent(uuid,timestamptz,boolean)'::regprocedure);
create function public.task_app_attendance_change_open(category_name text,selected_date date,at_time timestamptz)
returns boolean language plpgsql immutable set search_path='' as $$
declare local_day date;weekday integer;
begin
 if at_time is null or not isfinite(at_time) then return false;end if;
 local_day:=(at_time at time zone 'Asia/Kolkata')::date;
 if (at_time at time zone 'Asia/Kolkata')::time>=time '21:00' then return false;end if;
 if category_name='Special Meeting' then
  return selected_date is not null and isfinite(selected_date) and selected_date=local_day;
 end if;
 weekday:=case category_name when 'Sunday Service' then 0 when 'Healing Meeting' then 3 when 'Revival Meeting' then 5 else null end;
 return coalesce(extract(dow from local_day)::integer=weekday,false);
end;$$;
-- A client cannot supply a fake clock to bypass the checked mutation functions.
revoke all on function public.task_app_attendance_change_open(text,date,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.task_app_mark_absent(selected_category uuid,selected_date date default null,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;c public.categories;a public.account_member_absences;ends_at timestamptz;action_time timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true then raise exception 'Confirm absence first' using errcode='23514';end if;
 select * into c from public.categories where id=selected_category and owner_id=m.owner_id;
 if c.id is null or c.name not in ('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting') then
 raise exception 'Choose a meeting category' using errcode='23514';end if;
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

do $$begin
 if exists(select 1 from attendance_window_grants g join pg_proc p on p.oid=g.oid
  where p.proowner is distinct from g.proowner or p.proacl is distinct from g.proacl) then
  raise exception 'Attendance window changed existing function privileges';end if;
end;$$;
notify pgrst,'reload schema';
commit;
