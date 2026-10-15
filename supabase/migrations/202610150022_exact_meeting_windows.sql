-- Local reviewed timing update. Apply once after coordinated live approval.
-- Preserve tasks, accounts, issued fines, annual totals and existing grants.
-- 11:59 PM includes the full minute; stored period ends use exclusive midnight.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.tasks,public.task_fine_candidates,public.account_member_absences,public.task_fines,public.member_completion_totals in share row exclusive mode;
do $$begin
 if position('05:00' in pg_get_functiondef('public.task_app_fine_cutoff(text,date,time)'::regprocedure))=0 then
  raise exception 'Timing migration022 is already installed or the existing cutoff needs review';end if;
end;$$;
-- Do not issue retrospective fines when moving an already elapsed cutoff earlier.
create temporary table timing_rollout on commit drop as select statement_timestamp() at_time;
create temporary table timing_preserved on commit drop as select
 (select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by t.id),''))from public.tasks t) tasks_hash,
 (select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by f.id),''))from public.task_fines f) fines_hash,
 (select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by t.owner_id,t.member_id,t.completion_year),''))from public.member_completion_totals t) totals_hash;
create or replace function public.task_app_history_expires(category_name text,completed_when timestamptz,scheduled_date date,selected_days smallint[])
returns timestamptz language plpgsql immutable set search_path='' as $$
declare local_day date:=(completed_when at time zone 'Asia/Kolkata')::date;
 candidate date;cutoff timestamptz;reset_day integer;
begin
 if completed_when is null then return null;end if;
 if category_name='Special Meeting' then
  if scheduled_date is not null then
   cutoff:=((scheduled_date+2)+time '00:00') at time zone 'Asia/Kolkata';
   if cutoff>completed_when then return cutoff;end if;
  end if;
  if coalesce(cardinality(selected_days),0)>0 then
   candidate:=local_day-1;
   for i in 0..8 loop
    cutoff:=((candidate+2)+time '00:00') at time zone 'Asia/Kolkata';
    if extract(dow from candidate)::smallint=any(selected_days) and cutoff>completed_when then return cutoff;end if;
    candidate:=candidate+1;
   end loop;
  end if;
  return ((local_day+2)+time '00:00') at time zone 'Asia/Kolkata';
 end if;
 reset_day:=case category_name when 'Sunday Service' then 1 when 'Healing Meeting' then 4
  when 'Revival Meeting' then 6 else null end;
 if reset_day is null then return null;end if;
 candidate:=local_day+((reset_day-extract(dow from local_day)::integer+7)%7);
 cutoff:=((candidate+1)+time '00:00') at time zone 'Asia/Kolkata';
 if cutoff<=completed_when then cutoff:=((candidate+8)+time '00:00') at time zone 'Asia/Kolkata';end if;
 return cutoff;
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
  ends_at:=((selected_date+2)+time '00:00') at time zone 'Asia/Kolkata';
 else
  if selected_date is not null then raise exception 'Only Special Meeting uses a selected date' using errcode='23514';end if;
  ends_at:=public.task_app_history_expires(c.name,statement_timestamp(),null,'{}');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||c.id::text,0));
 -- Serialize the effective attendance time with the 1 AM assessment job.
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

create or replace function public.task_app_fine_cutoff(category_name text,scheduled_date date,due_time time)
returns timestamptz language plpgsql immutable set search_path='' as $$
declare target integer;day date;due_at timestamptz;result timestamptz;
begin
 if scheduled_date is null or scheduled_date>date '9999-12-22' then return null;end if;
 if category_name='Special Meeting'then return((scheduled_date+1)+time '01:00')at time zone 'Asia/Kolkata';end if;
 target:=case category_name when 'Sunday Service'then 1 when 'Healing Meeting'then 4 when 'Revival Meeting'then 6 else null end;
 if target is null then return null;end if;
 day:=scheduled_date+((target-extract(dow from scheduled_date)::integer+7)%7);
 result:=(day+time '01:00')at time zone 'Asia/Kolkata';
 due_at:=case when due_time is null then(scheduled_date+1)::timestamp at time zone 'Asia/Kolkata'else(scheduled_date+due_time)at time zone 'Asia/Kolkata'end;
 if result<due_at then result:=result+interval '7 days';end if;
 return result;
end;$$;

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
  select (public.task_app_history_expires('Special Meeting',completed_at,due_date,weekdays) at time zone 'Asia/Kolkata')::date-2 as meeting_day
  from special where status='completed' and completed_at<=current_time_value
 ),all_days as(select meeting_day from scheduled union select meeting_day from late_completed)
 select coalesce(jsonb_agg(jsonb_build_object('startsAt',meeting_day::timestamp at time zone 'Asia/Kolkata',
  'endsAt',((meeting_day+2)+time '00:00') at time zone 'Asia/Kolkata') order by meeting_day),'[]'::jsonb)
  into windows from all_days where meeting_day is not null and (((meeting_day+2)+time '00:00') at time zone 'Asia/Kolkata')>current_time_value;
 return jsonb_build_object('serverNow',current_time_value,'members',members,'totals',totals,'entries',entries,'specialWindows',windows);
end;$function$
;
-- Extend only still-active, unmarked intervals created under the old exact23:50 rule.
-- Expired/cancelled intervals and historical fine exemptions are never revived.
update public.account_member_absences a set expires_at=a.expires_at+interval '10 minutes'
from public.categories c where c.owner_id=a.owner_id and c.id=a.category_id
 and c.name in('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting')
 and a.cancelled_at is null and a.expires_at>(select at_time from timing_rollout)
 and (a.expires_at at time zone 'Asia/Kolkata')::time=time '23:50';
-- Freeze elapsed candidates with their original historical cutoff. New rules affect
-- only cutoffs still in the future at rollout; no issued fine is rewritten.
update public.task_fine_candidates q set
 cutoff_at=public.task_app_fine_cutoff(q.category_name,q.scheduled_date,
  t.due_time),
 finalized=coalesce(public.task_app_fine_cutoff(q.category_name,q.scheduled_date,
  t.due_time)<=(select at_time from timing_rollout),false)
 from public.tasks t where t.id=q.task_id and not q.finalized and q.cutoff_at>(select at_time from timing_rollout)
 and q.category_name in('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting');
do $$declare expected timing_preserved;begin
 select *into expected from timing_preserved;
 if expected.tasks_hash is distinct from(select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by t.id),''))from public.tasks t)
 or expected.fines_hash is distinct from(select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by f.id),''))from public.task_fines f)
 or expected.totals_hash is distinct from(select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by t.owner_id,t.member_id,t.completion_year),''))from public.member_completion_totals t)
 then raise exception 'Timing update changed saved tasks, issued fines or annual totals';end if;
end;$$;
notify pgrst,'reload schema';
commit;
