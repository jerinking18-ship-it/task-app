-- DISPOSABLE SQL ONLY. Existing-template/task preservation snapshot.
\set ON_ERROR_STOP on
insert into auth.users(id) values('00000000-0000-4000-8000-000000001071'),('00000000-0000-4000-8000-000000001072');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001073','00000000-0000-4000-8000-000000001071'),('00000000-0000-4000-8000-000000001074','00000000-0000-4000-8000-000000001072'),('00000000-0000-4000-8000-000000001075','00000000-0000-4000-8000-000000001071');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001071';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001073';set role authenticated;
select public.task_app_choose_member(null,'Template Bin Daniel')->'current'->>'name';
select public.task_app_save_template('00000000-0000-4000-8000-000000001081',null,'Sound team setup','[{"title":"Check microphones","notes":"Test audio"},{"title":"Check livestream","notes":"Test video"},{"title":"Arrange equipment","notes":""},{"title":"Sound check","notes":"Check sound"},{"title":"Check lighting","notes":"Check lights"}]')->>'name';
reset role;
insert into public.tasks(id,title,notes,status) values('00000000-0000-4000-8000-000000001081','Check microphones','A task previously created from this template','completed');
reset role;
create table public.local_template_bin_tasks as select * from public.tasks;
create table public.local_template_bin_templates as select to_jsonb(t) as payload from public.task_templates t;
