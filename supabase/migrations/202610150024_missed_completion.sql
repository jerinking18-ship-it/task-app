-- LOCAL ONLY: confirmed managerial completion of missed assigned work.
-- No existing data, grants on existing RPCs, fine activation, or jobs change.
begin;
alter table public.tasks add column missed_completion_role text,
 add constraint tasks_missed_completion check(missed_completion_role is null or
  (missed_completion_role in ('owner','coordinator') and status='completed'
   and completed_by_member_id is not null and assigned_to_member_id is not null
   and completed_by_member_id<>assigned_to_member_id));
alter table public.member_task_completions add column missed_completion boolean not null default false;
create or replace function public.task_app_set_completion_member() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.account_members;
begin
 m:=public.task_app_current_member();
 if new.status='active' then new.completed_by_member_id:=null;new.completed_by_name:=null;new.missed_completion_role:=null;
 elsif tg_op='UPDATE' and old.status='completed' then new.completed_by_member_id:=old.completed_by_member_id;new.completed_by_name:=old.completed_by_name;new.missed_completion_role:=old.missed_completion_role;
 elsif m.id is not null and m.owner_id=new.owner_id then new.completed_by_member_id:=m.id;new.completed_by_name:=m.name;
 else new.completed_by_member_id:=null;new.completed_by_name:=null;new.missed_completion_role:=null;end if;
 return new;
end;$$;

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
 insert into public.member_task_completions as r(owner_id,task_id,member_id,completed_at,completion_year,counted,missed_completion)
  values(new.owner_id,new.id,new.completed_by_member_id,new.completed_at,
   extract(year from new.completed_at at time zone 'Asia/Kolkata')::integer,true,new.missed_completion_role is not null)
  on conflict(owner_id,task_id) do update set counted=true,
   member_id=case when r.missed_completion or excluded.missed_completion then excluded.member_id else r.member_id end,
   completed_at=case when r.missed_completion or excluded.missed_completion then excluded.completed_at else r.completed_at end,
   completion_year=case when r.missed_completion or excluded.missed_completion then excluded.completion_year else r.completion_year end,
   missed_completion=excluded.missed_completion
   where not r.counted
  returning * into receipt;
 if receipt.task_id is not null then
  insert into public.member_completion_totals(owner_id,member_id,completion_year,completed_count)
   values(receipt.owner_id,receipt.member_id,receipt.completion_year,1)
   on conflict(owner_id,member_id,completion_year) do update
    set completed_count=public.member_completion_totals.completed_count+1;
 end if;
 return null;
end;$$;
create or replace function public.task_app_legacy_before_coverage_mutate(task_id uuid,expected_version timestamptz,operation text,fields jsonb default null,new_status text default null,edit_scope text default 'this',expected_series_version timestamptz default null)
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

-- Explicit confirmation is separate from ordinary status/update APIs. Identity,
-- workspace, assignee and role are server-derived; no caller supplies a fine.
create function public.task_app_complete_missed(task_id uuid,expected_version timestamptz,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;assignee public.account_members;
 category_name text;at_time timestamptz;activation timestamptz;
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
 update public.task_fine_candidates c set finalized=true where c.task_id=t.id;
 -- Existing status triggers stamp the actual actor/time, queue just one future
 -- occurrence and add the actor's yearly credit in this same transaction.
 return to_jsonb(t)||jsonb_build_object('series_version',(select max(updated_at)from public.tasks
  where owner_id=m.owner_id and deleted_at is null and(series_id=t.series_id or id=t.id)));
end;$$;
revoke all on function public.task_app_complete_missed(uuid,timestamptz,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_complete_missed(uuid,timestamptz,boolean)to authenticated;
notify pgrst,'reload schema';
commit;
