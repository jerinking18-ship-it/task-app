-- DISPOSABLE PostgreSQL ONLY. Surviving baseline before migration012.
insert into auth.users(id) values('00000000-0000-4000-8000-000000001001');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001011','00000000-0000-4000-8000-000000001001');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001001';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001011';
set role authenticated;
select public.task_app_choose_member(null,'History Baseline')->'current'->>'name';
insert into public.tasks(title,status) values('Surviving completion','completed'),('Bin baseline completion','completed'),('Still active','active');
do $$declare t public.tasks;begin select * into t from public.tasks where title='Bin baseline completion';perform public.task_app_mutate(t.id,t.updated_at,'delete');end$$;
reset role;
create table public.local_history_snapshot as select * from public.tasks;
