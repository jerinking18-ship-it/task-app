-- LOCAL REVIEW ONLY. Durable completion statistics; existing tasks/Auth untouched.
begin;
create table public.member_task_completions(
 owner_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null,
 member_id uuid not null,
 completed_at timestamptz not null,
 completion_year integer not null check(completion_year between 1 and 9999),
 primary key(owner_id,task_id),
 foreign key(owner_id,member_id) references public.account_members(owner_id,id)
);
-- No task FK: physical task deletion cannot erase its minimal counting receipt.
-- No task title/notes/category payload is retained in this receipt.
create index member_completions_year on public.member_task_completions(owner_id,member_id,completion_year);
create table public.member_completion_totals(
 owner_id uuid not null references auth.users(id) on delete cascade,
 member_id uuid not null,
 completion_year integer not null check(completion_year between 1 and 9999),
 completed_count bigint not null check(completed_count>=0 and completed_count<=9007199254740991),
 primary key(owner_id,member_id,completion_year),
 foreign key(owner_id,member_id) references public.account_members(owner_id,id)
);
alter table public.member_task_completions enable row level security;
alter table public.member_completion_totals enable row level security;
revoke all on public.member_task_completions,public.member_completion_totals from public,anon,authenticated,service_role;

create function public.task_app_count_member_completion()
returns trigger language plpgsql security definer set search_path='' as $$
declare saved_year integer;inserted_task uuid;
begin
 if new.status<>'completed' or new.completed_at is null or new.completed_by_member_id is null then return null;end if;
 if tg_op='UPDATE' and old.status='completed' then return null;end if;
 saved_year:=extract(year from new.completed_at at time zone 'Asia/Kolkata')::integer;
 insert into public.member_task_completions(owner_id,task_id,member_id,completed_at,completion_year)
  values(new.owner_id,new.id,new.completed_by_member_id,new.completed_at,saved_year)
  on conflict(owner_id,task_id) do nothing returning task_id into inserted_task;
 if inserted_task is not null then
  insert into public.member_completion_totals(owner_id,member_id,completion_year,completed_count)
   values(new.owner_id,new.completed_by_member_id,saved_year,1)
   on conflict(owner_id,member_id,completion_year) do update
    set completed_count=public.member_completion_totals.completed_count+1;
 end if;
 return null;
end;$$;
create trigger tasks_count_member_completion after insert or update on public.tasks
 for each row execute function public.task_app_count_member_completion();
create trigger member_totals_live_sync after insert or update on public.member_completion_totals
 for each row execute function public.task_app_notify_sync('tasks');

-- One-time baseline from surviving verifiable attributed completions, including
-- recoverable Bin. Already-purged completions cannot be reconstructed or invented.
insert into public.member_task_completions(owner_id,task_id,member_id,completed_at,completion_year)
 select t.owner_id,t.id,t.completed_by_member_id,t.completed_at,
  extract(year from t.completed_at at time zone 'Asia/Kolkata')::integer
 from public.tasks t where t.status='completed' and t.completed_at is not null and t.completed_by_member_id is not null;
insert into public.member_completion_totals(owner_id,member_id,completion_year,completed_count)
 select owner_id,member_id,completion_year,count(*) from public.member_task_completions group by owner_id,member_id,completion_year;

-- Pure calendar helpers use India time and never change tasks/report state.
create function public.task_app_history_expires(category_name text,completed_when timestamptz,scheduled_date date,selected_days smallint[])
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
  when 'Woman''s Meeting' then 5 when 'Revival Meeting' then 6 else null end;
 if reset_day is null then return null;end if;
 candidate:=local_day+((reset_day-extract(dow from local_day)::integer+7)%7);
 cutoff:=(candidate+time '23:50') at time zone 'Asia/Kolkata';
 if cutoff<=completed_when then cutoff:=((candidate+7)+time '23:50') at time zone 'Asia/Kolkata';end if;
 return cutoff;
end;$$;

create function public.task_app_member_history()
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid();member public.account_members;members jsonb;totals jsonb;entries jsonb;windows jsonb;
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
end;$$;
revoke all on function public.task_app_count_member_completion(),public.task_app_history_expires(text,timestamptz,date,smallint[]),public.task_app_member_history()
 from public,anon,authenticated,service_role;
grant execute on function public.task_app_member_history() to authenticated;
notify pgrst,'reload schema';
commit;
