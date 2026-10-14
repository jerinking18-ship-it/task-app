-- DISPOSABLE PostgreSQL ONLY. Never run fixture data against hosted Supabase.
\set ON_ERROR_STOP on
begin;
do $$begin
 assert not exists((select * from public.tasks except select * from public.local_history_snapshot) union all (select * from public.local_history_snapshot except select * from public.tasks));
 assert (select count(*) from public.member_task_completions where owner_id='00000000-0000-4000-8000-000000001001')=2;
 assert (select completed_count from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001001')=2;
 -- Exact boundary uses the NEXT cutoff; all timestamps are India local.
 assert public.task_app_history_expires('Sunday Service','2026-10-12 23:49:59+05:30',null,null)='2026-10-12 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Sunday Service','2026-10-12 23:50+05:30',null,null)='2026-10-19 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Healing Meeting','2026-10-16 09:00+05:30',null,null)='2026-10-22 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Woman''s Meeting','2026-12-31 23:59+05:30',null,null)='2027-01-01 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Revival Meeting','2026-10-16 12:00+05:30',null,null)='2026-10-17 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Special Meeting','2026-10-14 12:00+05:30','2026-10-14',array[3]::smallint[])='2026-10-15 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Special Meeting','2026-10-15 23:50+05:30','2026-10-14',array[3]::smallint[])='2026-10-22 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Special Meeting','2026-10-16 12:00+05:30',null,'{}'::smallint[])='2026-10-17 23:50+05:30'::timestamptz;
 assert public.task_app_history_expires('Unknown','2026-10-14 12:00+05:30',null,null) is null;
end$$;
insert into auth.users(id) values('00000000-0000-4000-8000-000000001002');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001012','00000000-0000-4000-8000-000000001001'),('00000000-0000-4000-8000-000000001013','00000000-0000-4000-8000-000000001002');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001001';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001011';
set role authenticated;
insert into public.categories(name) values('Healing Meeting'),('Special Meeting');
insert into public.tasks(title,category_id,status) select 'New history completion',id,'completed' from public.categories where name='Healing Meeting';
insert into public.tasks(title,category_id,due_date) select 'Special scheduled',id,(statement_timestamp() at time zone 'Asia/Kolkata')::date from public.categories where name='Special Meeting';
do $$declare r jsonb;t public.tasks;begin
 r:=public.task_app_member_history();assert jsonb_array_length(r->'entries')=1;assert (r->'entries'->0->>'title')='New history completion';
 assert jsonb_array_length(r->'specialWindows')=1;
 assert (r->'totals'->0->>'count')::integer=3;
 begin select * from public.member_completion_totals;raise exception 'Expected direct totals denied';exception when insufficient_privilege then null;end;
 begin select * from public.member_task_completions;raise exception 'Expected receipt denied';exception when insufficient_privilege then null;end;
 select * into t from public.tasks where title='New history completion';perform public.task_app_mutate(t.id,t.updated_at,'status',null,'active');
 assert jsonb_array_length(public.task_app_member_history()->'entries')=0;
 assert (public.task_app_member_history()->'totals'->0->>'count')::integer=3;
end$$;
-- Recomplete as another member: visible attribution changes, yearly credit does not.
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001012';
select public.task_app_choose_member(null,'History Second')->'current'->>'name';
do $$declare t public.tasks;r jsonb;begin
 select * into t from public.tasks where title='New history completion';perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
 r:=public.task_app_member_history();assert r->'entries'->0->>'memberId'=r->'members'->0->>'id';assert jsonb_array_length(r->'totals')=1;
 select * into t from public.tasks where title='New history completion';perform public.task_app_mutate(t.id,t.updated_at,'delete');
 assert jsonb_array_length(public.task_app_member_history()->'entries')=0;
 select * into t from public.tasks where id=t.id;perform public.task_app_bin('purge',jsonb_build_array(jsonb_build_object('id',t.id,'version',t.updated_at)),true);
 assert (public.task_app_member_history()->'totals'->0->>'count')::integer=3;
 assert not exists(select 1 from public.tasks where title='New history completion');
 -- Completed clear physically removes baseline but preserves totals.
 r:=public.task_app_completed('preview');perform public.task_app_completed('purge',(r->>'count')::bigint,r->>'snapshot',true);
 assert (public.task_app_member_history()->'totals'->0->>'count')::integer=3;
end$$;
reset role;
-- Server-only clock fixtures verify year attribution and immutable first receipt.
alter table public.tasks disable trigger tasks_set_metadata;
alter table public.tasks disable trigger tasks_completion_member;
insert into public.tasks(owner_id,title,status,completed_at,completed_by_member_id,completed_by_name)
 select '00000000-0000-4000-8000-000000001001','Year boundary','completed','2026-12-31 18:30:00Z',id,name from public.account_members where name='History Second';
do $$begin assert (select completed_count from public.member_completion_totals where completion_year=2027)=1;end$$;
update public.tasks set status='active',completed_at=null,completed_by_member_id=null,completed_by_name=null where title='Year boundary';
update public.tasks set status='completed',completed_at='2028-01-01 00:00+05:30',completed_by_member_id=(select id from public.account_members where name='History Second'),completed_by_name='History Second' where title='Year boundary';
do $$begin assert not exists(select 1 from public.member_completion_totals where completion_year=2028);assert (select count(*) from public.member_task_completions where owner_id='00000000-0000-4000-8000-000000001001')=4;end$$;
alter table public.tasks enable trigger tasks_set_metadata;
alter table public.tasks enable trigger tasks_completion_member;
-- Foreign and unselected accounts cannot obtain another owner's content.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001002';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001013';
set role authenticated;
do $$begin begin perform public.task_app_member_history();raise exception 'Expected unselected denied';exception when insufficient_privilege then null;end;end$$;
select public.task_app_choose_member(null,'History Foreign')->'current'->>'name';
do $$declare r jsonb;begin r:=public.task_app_member_history();assert jsonb_array_length(r->'totals')=0;assert jsonb_array_length(r->'entries')=0;assert jsonb_array_length(r->'specialWindows')=0;assert jsonb_array_length(r->'members')=1;end$$;
select public.task_app_leave_member();
do $$begin begin perform public.task_app_member_history();raise exception 'Expected left denied';exception when insufficient_privilege then null;end;end$$;
reset role;
set role anon;
do $$begin begin perform public.task_app_member_history();raise exception 'Expected anon denied';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$begin assert not exists(select 1 from realtime.messages where payload ? 'title' or payload ? 'notes' or payload ? 'count');end$$;
rollback;
select 'Member history: baseline unchanged, attribution, yearly boundaries, late cutoffs, Special windows, purge independence, account/member isolation passed';
