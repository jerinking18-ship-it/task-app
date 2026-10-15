-- Local review only. Installing this migration DOES NOT enable deletion.
-- A separately reviewed admin activation enables regular completed retention.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.task_retention_configuration(singleton boolean primary key default true check(singleton),enabled_at timestamptz);
insert into public.task_retention_configuration(singleton)values(true);
alter table public.task_retention_configuration enable row level security;
revoke all on public.task_retention_configuration from public,anon,authenticated,service_role;
create temporary table retention_grants on commit drop as select oid,proowner,proacl from pg_proc where oid='public.task_app_purge_history()'::regprocedure;
create or replace function public.task_app_purge_history()
returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
 delete from public.tasks where status='completed'and deleted_at is null and(
  history_at<=statement_timestamp()-interval '30 days'
  or((select enabled_at is not null from public.task_retention_configuration where singleton)
   and completed_at<=statement_timestamp()-interval '7 days'and history_at is null
   and repeat_rule='off'and series_id is null and next_occurrence_id is null));
 get diagnostics removed=row_count;return removed;
end;$$;
do $$begin
 if exists(select 1 from retention_grants g join pg_proc p on p.oid=g.oid where p.proowner is distinct from g.proowner or p.proacl is distinct from g.proacl)then raise exception 'Existing retention privileges changed';end if;
end;$$;
notify pgrst,'reload schema';
commit;
