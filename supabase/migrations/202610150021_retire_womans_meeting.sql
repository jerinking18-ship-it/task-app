-- Retire one meeting category and its saved tasks only after explicit live approval.
-- LOCAL TESTED MIGRATION: destructive category-specific cleanup, not a general reset.
-- Apply ONCE with the separately reviewed, exact-count live guard. Never replay001–020.
-- Established annual completion credits and issued fines remain unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.tasks,public.categories,public.task_repeat_pending,public.task_series,
 public.account_member_absences,public.task_coverage_claims,public.task_fine_candidates,
 public.task_fines in access exclusive mode;
do $$begin
 if exists(select 1 from pg_constraint where conrelid='public.categories'::regclass and conname='categories_no_retired_womans_meeting')then
  raise exception 'Meeting retirement021 is already installed';
 end if;
end;$$;
create temporary table retiring_categories on commit drop as
 select id,owner_id from public.categories where lower(replace(name,chr(8217),chr(39)))='woman''s meeting';
create temporary table retiring_tasks on commit drop as
 select t.id,t.owner_id,t.series_id from public.tasks t join retiring_categories c on c.id=t.category_id and c.owner_id=t.owner_id;
create temporary table retiring_series on commit drop as
 select distinct owner_id,series_id id from retiring_tasks where series_id is not null
 union select distinct p.owner_id,p.series_id from public.task_repeat_pending p join retiring_categories c on c.id::text=p.payload->>'category_id' and c.owner_id=p.owner_id;
-- Refuse deleting provenance from a task that now belongs to another meeting.
do $$begin
 if exists(select 1 from public.task_coverage_claims q join public.account_member_absences a on a.id=q.absence_id
 join retiring_categories c on c.id=a.category_id and c.owner_id=a.owner_id
 where not exists(select 1 from retiring_tasks t where t.id=q.task_id))then
 raise exception 'Cross-category claims require separate preservation review';end if;
 if exists(select 1 from public.task_fines where lower(replace(category_name,chr(8217),chr(39)))='woman''s meeting')then
 raise exception 'Issued fine records require separate review';end if;
end;$$;
-- Compare retained records inside the same transaction; no data export is created.
create temporary table retirement_preserved on commit drop as select
 (select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by t.id),''))from public.tasks t where not exists(select 1 from retiring_tasks d where d.id=t.id)) tasks_hash,
 (select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by f.id),''))from public.task_fines f) fines_hash,
 (select md5(coalesce(string_agg(to_jsonb(c)::text,'|'order by c.owner_id,c.task_id),''))from public.member_task_completions c) credits_hash,
 (select md5(coalesce(string_agg(to_jsonb(c)::text,'|'order by c.owner_id,c.member_id,c.completion_year),''))from public.member_completion_totals c) totals_hash,
 (select md5(coalesce(string_agg(to_jsonb(c)::text,'|'order by c.singleton),''))from public.task_fine_configuration c) config_hash;
create or replace function public.task_app_setup(operation text,category_name text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;n text;result public.categories;
begin
 m:=public.task_app_require_role();
 -- First verified membership can initialize the fixed baseline, including a
 -- Member on a workspace whose Owner has not opened tasks yet.
 insert into public.account_settings(owner_id,timezone) values(m.owner_id,'Asia/Kolkata') on conflict(owner_id) do nothing;
 if operation='category' then
  m:=public.task_app_require_role(true);n:=btrim(category_name);
  if lower(replace(n,chr(8217),chr(39)))='woman''s meeting' then raise exception 'This meeting category has been retired' using errcode='23514';end if;
  if n is null or char_length(n) not between 1 and 40 then raise exception 'Invalid category' using errcode='23514';end if;
  insert into public.categories(owner_id,name) values(m.owner_id,n) on conflict do nothing;
  select * into result from public.categories where owner_id=m.owner_id and lower(name)=lower(n);
  return jsonb_build_object('category',jsonb_build_object('id',result.id,'name',result.name));
 elsif operation='bootstrap' then
  foreach n in array array['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting'] loop
   insert into public.categories(owner_id,name) values(m.owner_id,n) on conflict do nothing;
  end loop;
 elsif operation<>'setup' then raise exception 'Invalid setup' using errcode='23514';end if;
 return jsonb_build_object('timezone','Asia/Kolkata');
end;$$;

create or replace function public.task_app_mark_absent(selected_category uuid,selected_date date default null,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;c public.categories;a public.account_member_absences;ends_at timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true then raise exception 'Confirm absence first' using errcode='23514';end if;
 select * into c from public.categories where id=selected_category and owner_id=m.owner_id;
 if c.id is null or c.name not in ('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting') then
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

create or replace function public.task_app_history_expires(category_name text,completed_when timestamptz,scheduled_date date,selected_days smallint[])
returns timestamptz language plpgsql immutable set search_path='' as $$
declare local_day date:=(completed_when at time zone 'Asia/Kolkata')::date;
 candidate date;cutoff timestamptz;reset_day integer;
begin
 if completed_when is null then return null;end if;
 if category_name='Special Meeting' then
  if scheduled_date is not null then
   cutoff:=((scheduled_date+1)+time '23:50') at time zone 'Asia/Kolkata';
   if cutoff>completed_when then return cutoff;end if;
  end if;
  if coalesce(cardinality(selected_days),0)>0 then
   candidate:=local_day-1;
   for i in 0..8 loop
    cutoff:=((candidate+1)+time '23:50') at time zone 'Asia/Kolkata';
    if extract(dow from candidate)::smallint=any(selected_days) and cutoff>completed_when then return cutoff;end if;
    candidate:=candidate+1;
   end loop;
  end if;
  return ((local_day+1)+time '23:50') at time zone 'Asia/Kolkata';
 end if;
 reset_day:=case category_name when 'Sunday Service' then 1 when 'Healing Meeting' then 4
  when 'Revival Meeting' then 6 else null end;
 if reset_day is null then return null;end if;
 candidate:=local_day+((reset_day-extract(dow from local_day)::integer+7)%7);
 cutoff:=(candidate+time '23:50') at time zone 'Asia/Kolkata';
 if cutoff<=completed_when then cutoff:=((candidate+7)+time '23:50') at time zone 'Asia/Kolkata';end if;
 return cutoff;
end;$$;

create or replace function public.task_app_fine_cutoff(category_name text,scheduled_date date,due_time time)
returns timestamptz language plpgsql immutable set search_path='' as $$
declare target integer;day date;due_at timestamptz;result timestamptz;
begin
 if scheduled_date is null or scheduled_date>date '9999-12-22' then return null;end if;
 if category_name='Special Meeting'then return((scheduled_date+1)+time '05:00')at time zone 'Asia/Kolkata';end if;
 target:=case category_name when 'Sunday Service'then 1 when 'Healing Meeting'then 4 when 'Revival Meeting'then 6 else null end;
 if target is null then return null;end if;
 day:=scheduled_date+((target-extract(dow from scheduled_date)::integer+7)%7);
 result:=(day+time '05:00')at time zone 'Asia/Kolkata';
 due_at:=case when due_time is null then(scheduled_date+1)::timestamp at time zone 'Asia/Kolkata'else(scheduled_date+due_time)at time zone 'Asia/Kolkata'end;
 if result<due_at then result:=result+interval '7 days';end if;
 return result;
end;$$;

-- Discard pending assessments first so deleting tasks cannot issue retired fines.
delete from public.task_fine_candidates where task_id in(select id from retiring_tasks)
 or lower(replace(category_name,chr(8217),chr(39)))='woman''s meeting';
delete from public.task_repeat_pending p using retiring_categories c where p.owner_id=c.owner_id and p.payload->>'category_id'=c.id::text;
-- Preserve a different meeting's future occurrence whose source task is removed.
update public.task_repeat_pending set source_task_id=null where source_task_id in(select id from retiring_tasks);
delete from public.tasks where id in(select id from retiring_tasks);
delete from public.account_member_absences a using retiring_categories c where a.owner_id=c.owner_id and a.category_id=c.id;
-- Shared series with any remaining occurrence or queue row are retained.
delete from public.task_series s using retiring_series d where s.owner_id=d.owner_id and s.id=d.id
 and not exists(select 1 from public.tasks t where t.owner_id=s.owner_id and t.series_id=s.id)
 and not exists(select 1 from public.task_repeat_pending p where p.owner_id=s.owner_id and p.series_id=s.id);
delete from public.categories where id in(select id from retiring_categories);
alter table public.categories add constraint categories_no_retired_womans_meeting
 check(lower(replace(name,chr(8217),chr(39)))<>'woman''s meeting');
do $$declare expected retirement_preserved;begin
 select * into expected from retirement_preserved;
 if expected.tasks_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by t.id),''))from public.tasks t)
 or expected.fines_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by f.id),''))from public.task_fines f)
 or expected.credits_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(c)::text,'|'order by c.owner_id,c.task_id),''))from public.member_task_completions c)
 or expected.totals_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(c)::text,'|'order by c.owner_id,c.member_id,c.completion_year),''))from public.member_completion_totals c)
 or expected.config_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(c)::text,'|'order by c.singleton),''))from public.task_fine_configuration c)
 then raise exception 'Retained task, annual credit, fine or activation data changed; retirement refused';end if;
end;$$;
-- CREATE OR REPLACE preserves existing role checks, owners, privileges and search paths.
-- No grants, authentication changes, fine activation, cron installation or schema reset.
commit;
