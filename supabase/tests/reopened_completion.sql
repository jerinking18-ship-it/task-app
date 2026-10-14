-- Disposable PostgreSQL ONLY. Never run fixtures against hosted Supabase.
\set ON_ERROR_STOP on
begin;
do $$begin
 assert not exists((select * from public.tasks except select * from public.local_reopen_snapshot) union all (select * from public.local_reopen_snapshot except select * from public.tasks));
 assert (select completed_count from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001051')=2;
 assert (select count(*) from public.member_task_completions where owner_id='00000000-0000-4000-8000-000000001051' and counted)=2;
 assert not (select counted from public.member_task_completions where task_id=(select id from public.tasks where title='Already reopened'));
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001051';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001052';set role authenticated;
do $$declare t public.tasks;v timestamptz;r jsonb;begin
 select * into t from public.tasks where title='Still completed';v:=t.updated_at;
 assert jsonb_array_length(public.task_app_member_history()->'entries')=1;
 perform public.task_app_mutate(t.id,v,'status',null,'active');
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=1;
 assert jsonb_array_length(public.task_app_member_history()->'entries')=0;
 r:=public.task_app_mutate(t.id,v,'status',null,'active');assert (r->>'conflict')::boolean;
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=1;
 select * into t from public.tasks where id=t.id;perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=2;
 -- Metadata edits and no-op status changes must never add credit.
 select * into t from public.tasks where id=t.id;perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=2;
 -- Bin and permanent purge retain the completion credit.
 select * into t from public.tasks where id=t.id;perform public.task_app_mutate(t.id,t.updated_at,'delete');
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=2;
 select * into t from public.tasks where id=t.id;perform public.task_app_bin('restore',jsonb_build_array(jsonb_build_object('id',t.id,'version',t.updated_at)),true);
 select * into t from public.tasks where id=t.id;perform public.task_app_mutate(t.id,t.updated_at,'delete');
 select * into t from public.tasks where id=t.id;perform public.task_app_bin('purge',jsonb_build_array(jsonb_build_object('id',t.id,'version',t.updated_at)),true);
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=2;
 -- A task completing for its first time still adds one.
 insert into public.tasks(title,status) values('Brand new completion','completed');
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=3;
 -- A failed enclosing write rolls back both receipt and counter changes.
 begin
  select * into t from public.tasks where title='Brand new completion';perform public.task_app_mutate(t.id,t.updated_at,'status',null,'active');
  raise exception 'rollback this attempt' using errcode='P0001';
 exception when raise_exception then null;end;
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=3;
 begin select counted from public.member_task_completions;raise exception 'Expected private receipts';exception when insufficient_privilege then null;end;
end$$;
reset role;
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001053','00000000-0000-4000-8000-000000001051');
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001053';set role authenticated;
select public.task_app_choose_member(null,'Reopen Second')->'current'->>'name';
do $$declare t public.tasks;begin
 select * into t from public.tasks where title='Already reopened';perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=4;
 assert jsonb_array_length(public.task_app_member_history()->'totals')=1;
 select * into t from public.tasks where id=t.id;assert t.completed_by_name='Reopen Second';
 perform public.task_app_mutate(t.id,t.updated_at,'status',null,'active');
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=3;
end$$;
reset role;
-- Recompletion preserves the occurrence's original member/year, even in another year.
alter table public.tasks disable trigger tasks_set_metadata;
alter table public.tasks disable trigger tasks_completion_member;
update public.tasks set status='completed',completed_at='2027-01-01 00:00+05:30',completed_by_member_id=(select id from public.account_members where name='Reopen First'),completed_by_name='Reopen First' where title='Already reopened';
do $$begin
 assert (select completed_count from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001051')=4;
 assert not exists(select 1 from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001051' and completion_year=2027);
 assert (select count(*) from public.member_task_completions where owner_id='00000000-0000-4000-8000-000000001051')=4;
end$$;
alter table public.tasks enable trigger tasks_set_metadata;
alter table public.tasks enable trigger tasks_completion_member;
rollback;
select 'PASS: reopen decrements, recompletion restores once, stale/no-op/rollback safe, purged credit retained, original year preserved, task rows untouched';
