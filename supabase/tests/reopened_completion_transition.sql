-- Disposable database ONLY: simulate an already-reopened and a purged completion.
\set ON_ERROR_STOP on
insert into auth.users(id) values('00000000-0000-4000-8000-000000001051');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001052','00000000-0000-4000-8000-000000001051');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001051';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001052';set role authenticated;
select public.task_app_choose_member(null,'Reopen First')->'current'->>'name';
insert into public.categories(name) values('Healing Meeting');
insert into public.tasks(title,category_id,status) select title,c.id,'completed' from public.categories c cross join (values('Already reopened'),('Purged credit'),('Still completed')) names(title) where c.name='Healing Meeting';
do $$declare t public.tasks;begin
 select * into t from public.tasks where title='Already reopened';perform public.task_app_mutate(t.id,t.updated_at,'status',null,'active');
end$$;
reset role;
delete from public.tasks where owner_id='00000000-0000-4000-8000-000000001051' and title='Purged credit';
create table public.local_reopen_snapshot as select * from public.tasks;
