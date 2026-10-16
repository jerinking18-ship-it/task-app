-- Local review only. Installing does NOT activate permanent deletion.
-- Apply once; use the separate approved activation after checking live eligibility.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.task_activity_retention_configuration(
 singleton boolean primary key default true check(singleton),
 enabled_at timestamptz
);
insert into public.task_activity_retention_configuration(singleton)values(true);
alter table public.task_activity_retention_configuration enable row level security;
revoke all on public.task_activity_retention_configuration from public,anon,authenticated,service_role;
create index activity_retention_time on public.task_activity_log(created_at);

create function public.task_app_purge_activity()
returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
 if not coalesce((select enabled_at is not null from public.task_activity_retention_configuration where singleton),false)then return 0;end if;
 delete from public.task_activity_log where created_at<=statement_timestamp()-interval '168 hours';
 get diagnostics removed=row_count;
 return removed;
end;$$;
revoke all on function public.task_app_purge_activity()from public,anon,authenticated,service_role;

-- Keep expired activity out of all filters and totals between hourly cleanup runs.
-- Preserve the existing manager checks, cursor ordering, function owner and ACL.
create temporary table activity_read_before on commit drop as
select oid,proowner,proacl,proconfig,prosecdef,pg_get_functiondef(oid)definition
from pg_proc where oid='public.task_app_activity(uuid,text,text,text,timestamptz,timestamptz,uuid)'::regprocedure;
do $$
declare previous text;updated text;
begin
 select definition into previous from activity_read_before;
 updated:=replace(previous,'where a.owner_id=m.owner_id',
 'where a.owner_id=m.owner_id and (not coalesce((select enabled_at is not null from public.task_activity_retention_configuration where singleton),false) or a.created_at>statement_timestamp()-interval ''168 hours'')');
 if updated=previous then raise exception 'Activity reader changed; review before installing retention';end if;
 execute updated;
 if exists(select 1 from activity_read_before b join pg_proc p on p.oid=b.oid
 where p.proowner is distinct from b.proowner or p.proacl is distinct from b.proacl
 or p.proconfig is distinct from b.proconfig or p.prosecdef is distinct from b.prosecdef)then
  raise exception 'Activity access changed unexpectedly';
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
