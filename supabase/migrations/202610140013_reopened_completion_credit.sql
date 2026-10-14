-- Additive correction: reopen removes credit; recompletion restores it once.
-- Preserve first member/year attribution and credits for physically purged tasks.
begin;
lock table public.tasks in share row exclusive mode;
lock table public.member_task_completions,public.member_completion_totals in share row exclusive mode;
alter table public.member_task_completions add column counted boolean not null default true;

-- Correct surviving tasks already reopened before this change. No task writes.
with reopened as (
 update public.member_task_completions r set counted=false
 from public.tasks t where t.owner_id=r.owner_id and t.id=r.task_id
  and t.status='active' and r.counted
 returning r.owner_id,r.member_id,r.completion_year
), deltas as (
 select owner_id,member_id,completion_year,count(*) as n from reopened group by 1,2,3
)
update public.member_completion_totals t set completed_count=t.completed_count-d.n
from deltas d where t.owner_id=d.owner_id and t.member_id=d.member_id
 and t.completion_year=d.completion_year;

create or replace function public.task_app_count_member_completion()
returns trigger language plpgsql security definer set search_path='' as $$
declare receipt public.member_task_completions;
begin
 if new.status='active' then
  if tg_op='UPDATE' and old.status='completed' then
   update public.member_task_completions set counted=false
    where owner_id=new.owner_id and task_id=new.id and counted
    returning * into receipt;
   if receipt.task_id is not null then
    update public.member_completion_totals set completed_count=completed_count-1
     where owner_id=receipt.owner_id and member_id=receipt.member_id
      and completion_year=receipt.completion_year;
   end if;
  end if;
  return null;
 end if;
 if new.completed_at is null or new.completed_by_member_id is null then return null;end if;
 if tg_op='UPDATE' and old.status='completed' then return null;end if;
 insert into public.member_task_completions as r(owner_id,task_id,member_id,completed_at,completion_year,counted)
  values(new.owner_id,new.id,new.completed_by_member_id,new.completed_at,
   extract(year from new.completed_at at time zone 'Asia/Kolkata')::integer,true)
  on conflict(owner_id,task_id) do update set counted=true where not r.counted
  returning * into receipt;
 if receipt.task_id is not null then
  insert into public.member_completion_totals(owner_id,member_id,completion_year,completed_count)
   values(receipt.owner_id,receipt.member_id,receipt.completion_year,1)
   on conflict(owner_id,member_id,completion_year) do update
    set completed_count=public.member_completion_totals.completed_count+1;
 end if;
 return null;
end;$$;
revoke all on function public.task_app_count_member_completion() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
