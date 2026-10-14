-- DISPOSABLE PostgreSQL ONLY. Never run fixtures against Supabase.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000901'),('00000000-0000-4000-8000-000000000902');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000901'),('00000000-0000-4000-8000-000000000912','00000000-0000-4000-8000-000000000902'),('00000000-0000-4000-8000-000000000913','00000000-0000-4000-8000-000000000901');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000901';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000911';
set role authenticated;
do $$ begin
 assert not exists(select 1 from public.task_templates);
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000921',null,'Before member','[{"title":"Test","notes":""}]');raise exception 'Expected unselected denied';exception when insufficient_privilege then null;end;
end $$;
select public.task_app_choose_member(null,'Template Example')->'current'->>'name';
do $$ declare first jsonb;retry jsonb;updated jsonb;begin
 first:=public.task_app_save_template('00000000-0000-4000-8000-000000000921',null,' Sound team setup ','[{"title":"Check microphones","notes":"Test audio"},{"title":"Check livestream","notes":"Test video"},{"title":"Arrange equipment","notes":""},{"title":"Sound check","notes":""},{"title":"Check stage lighting","notes":"Test lights"}]');
 assert first->>'name'='Sound team setup';assert jsonb_array_length(first->'items')=5;
 retry:=public.task_app_save_template('00000000-0000-4000-8000-000000000921',null,first->>'name',first->'items');
 assert retry=first;assert (select count(*) from public.task_templates)=1;
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000921',null,'Different name',first->'items');raise exception 'Expected conflicting retry';exception when sqlstate 'P0013' then null;end;
 updated:=public.task_app_save_template('00000000-0000-4000-8000-000000000921',(first->>'updated_at')::timestamptz,'Updated template',first->'items');
 assert (updated->>'updated_at')::timestamptz>(first->>'updated_at')::timestamptz;
 assert updated->>'created_at'=first->>'created_at';
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000921',(first->>'updated_at')::timestamptz,'Stale overwrite',first->'items');raise exception 'Expected stale conflict';exception when sqlstate 'P0013' then null;end;
 assert (select name from public.task_templates)='Updated template';
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000922',null,'Bad','[{"title":"Task","notes":"","repeat":"weekly"}]');raise exception 'Expected scheduling rejected';exception when check_violation then null;end;
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000922',null,'Bad','[]');raise exception 'Expected empty rejected';exception when check_violation then null;end;
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000922',null,'Bad','[{"title":"Task","notes":null}]');raise exception 'Expected null rejected';exception when check_violation then null;end;
 begin insert into public.task_templates(id,owner_id,name,items) values('00000000-0000-4000-8000-000000000922',auth.uid(),'Direct','[{"title":"Task","notes":""}]');raise exception 'Expected direct insert denied';exception when insufficient_privilege then null;end;
 begin update public.task_templates set name='Forged';raise exception 'Expected direct update denied';exception when insufficient_privilege then null;end;
 begin delete from public.task_templates;raise exception 'Expected direct delete denied';exception when insufficient_privilege then null;end;
 assert not exists(select 1 from public.tasks where title='Check microphones');
end $$;
-- Same account, second selected member shares the library.
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000913';
select public.task_app_choose_member(null,'Second Template Example')->'current'->>'name';
do $$ begin assert (select count(*) from public.task_templates)=1;end $$;
select public.task_app_leave_member();
do $$ begin
 assert not exists(select 1 from public.task_templates);
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000922',null,'Left','[{"title":"Task","notes":""}]');raise exception 'Expected left member denied';exception when insufficient_privilege then null;end;
end $$;
-- Foreign account cannot read or overwrite another account's saved template.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000902';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000912';
select public.task_app_choose_member(null,'Other Template Example')->'current'->>'name';
do $$ begin
 assert not exists(select 1 from public.task_templates);
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000921',null,'Foreign','[{"title":"Task","notes":""}]');raise exception 'Expected foreign collision denied';exception when sqlstate 'P0013' then null;end;
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000921',statement_timestamp(),'Foreign','[{"title":"Task","notes":""}]');raise exception 'Expected foreign update denied';exception when sqlstate 'P0013' then null;end;
end $$;
reset role;
do $$ begin
 assert public.task_app_valid_template_items('[{"title":"Good","notes":""}]');
 assert not public.task_app_valid_template_items('null');assert not public.task_app_valid_template_items('{}');
 assert not public.task_app_valid_template_items('[null]');assert not public.task_app_valid_template_items('[{"title":"","notes":""}]');
 assert not public.task_app_valid_template_items(jsonb_build_array(jsonb_build_object('title',E'\t\n','notes','')));
 assert not public.task_app_valid_template_items(jsonb_build_array(jsonb_build_object('title',repeat(' ',201)||'x','notes','')));
 assert not public.task_app_valid_template_items((select jsonb_agg(jsonb_build_object('title','Task','notes','')) from generate_series(1,21)));
 assert (select count(*) from public.task_templates)=1;
 assert (select name from public.task_templates)='Updated template';
 assert not exists(select 1 from realtime.messages where payload ? 'items' or payload ? 'title' or payload ? 'notes' or payload ? 'name');
end $$;
set role anon;
do $$ begin
 begin select * from public.task_templates;raise exception 'Expected anon read denied';exception when insufficient_privilege then null;end;
 begin perform public.task_app_save_template('00000000-0000-4000-8000-000000000922',null,'Anon','[{"title":"Task","notes":""}]');raise exception 'Expected anon write denied';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Templates: owner/member isolation, five-entry persistence, retry safety, stale conflicts, direct-write denial and private invalidations passed';
