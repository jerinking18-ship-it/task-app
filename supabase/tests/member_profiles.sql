-- DISPOSABLE LOCAL PostgreSQL ONLY. No production data or Auth requests.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000210'),('00000000-0000-4000-8000-000000000220');
insert into auth.sessions(id,user_id) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '00000000-0000-4000-8000-000000000210' from generate_series(211,215) n;
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000221','00000000-0000-4000-8000-000000000220');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000210';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000211';
set role authenticated;
select public.task_app_choose_member(null,'Daniel')->'current'->>'name';
insert into public.tasks(title) values('Profile history fixture');
do $$ declare t public.tasks; begin
  select * into t from public.tasks where title='Profile history fixture';
  perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert (select completed_by_name='Daniel' from public.tasks where id=t.id);
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000212';
do $$ declare own_member uuid; begin
  select id into own_member from public.account_members where name='Daniel';
  perform public.task_app_choose_member(own_member,null);
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000213';
select public.task_app_choose_member(null,'Grace')->'current'->>'name';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000211';
do $$ declare result jsonb; begin
  result:=public.task_app_rename_member(' Daniel  Mary ','Daniel');
  assert result->'current'->>'name'='Daniel Mary';
  assert public.task_app_rename_member('Daniel Mary','Daniel')->'current'->>'name'='Daniel Mary';
  assert (select completed_by_name='Daniel' from public.tasks where title='Profile history fixture');
  begin perform public.task_app_rename_member('Another name','Daniel'); raise exception 'Expected stale conflict'; exception when sqlstate 'P0011' then null; end;
  begin perform public.task_app_rename_member('gRaCe','Daniel Mary'); raise exception 'Expected duplicate'; exception when unique_violation then null; end;
  begin perform public.task_app_rename_member(E'Bad\nName','Daniel Mary'); raise exception 'Expected invalid name'; exception when check_violation then null; end;
  begin perform public.task_app_rename_member(null,'Daniel Mary'); raise exception 'Expected missing name'; exception when check_violation then null; end;
  insert into public.tasks(title,status) values('New name attribution','completed');
  assert (select completed_by_name='Daniel Mary' from public.tasks where title='New name attribution');
end $$;
reset role;
-- Fill the ten-member limit. Leaving must free exactly one active slot.
insert into public.account_members(owner_id,name) select '00000000-0000-4000-8000-000000000210','Extra '||n from generate_series(1,8) n;
create temporary table profile_task_snapshot as select * from public.tasks;
create temporary table profile_auth_snapshot as select * from auth.users;
create temporary table profile_session_snapshot as select * from auth.sessions;
set role authenticated;
do $$ begin
  assert public.task_app_leave_member();
  assert public.task_app_leave_member(); -- idempotent retry, no other member removed
  begin perform public.task_app_member_state(); raise exception 'Expected revoked read'; exception when insufficient_privilege then null; end;
  begin perform public.task_app_choose_member(null,'Rejoin old session'); raise exception 'Expected revoked choice'; exception when insufficient_privilege then null; end;
  begin insert into public.tasks(title) values('Revoked task denied'); raise exception 'Expected revoked write'; exception when insufficient_privilege then null; end;
  begin perform public.task_app_rename_member('Again','Daniel Mary'); raise exception 'Expected revoked rename'; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.account_members)=9; -- archived profile hidden by RLS
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000212';
do $$ begin
  begin perform public.task_app_member_state(); raise exception 'Expected second device revoked'; exception when insufficient_privilege then null; end;
  begin perform public.task_app_choose_member(null,'Cannot reuse session'); raise exception 'Expected second device choice revoked'; exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000213';
do $$ begin
  assert public.task_app_member_state()->'current'->>'name'='Grace';
  assert jsonb_array_length(public.task_app_member_state()->'members')=9;
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000214';
do $$ declare result jsonb; begin
  result:=public.task_app_choose_member(null,'Daniel Mary'); -- fresh login can rejoin
  assert result->'current'->>'name'='Daniel Mary';
  assert jsonb_array_length(result->'members')=10;
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000215';
do $$ begin
  begin perform public.task_app_choose_member(null,'Eleventh'); raise exception 'Expected cap'; exception when sqlstate 'P0010' then null; end;
  begin perform public.task_app_leave_member(); raise exception 'Expected unselected denial'; exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000220';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000221';
do $$ begin
  assert (select count(*) from public.account_members)=0;
  begin perform public.task_app_rename_member('Other','Daniel Mary'); raise exception 'Expected other owner denial'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists(select * from profile_task_snapshot except select * from public.tasks);
  assert not exists(select * from public.tasks except select * from profile_task_snapshot);
  assert not exists(select * from profile_auth_snapshot except select * from auth.users);
  assert not exists(select * from profile_session_snapshot except select * from auth.sessions);
  assert (select count(*) from public.account_members where owner_id='00000000-0000-4000-8000-000000000210' and left_at is not null)=1;
  assert (select count(*) from public.account_member_sessions where session_id in ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000212'))=2;
  assert (select completed_by_name='Daniel' from public.tasks where title='Profile history fixture');
  assert (select completed_by_name='Daniel Mary' from public.tasks where title='New name attribution');
  assert not has_function_privilege('anon','public.task_app_rename_member(text,text)','execute');
  assert not has_function_privilege('service_role','public.task_app_leave_member()','execute');
  assert not has_column_privilege('authenticated','public.account_members','left_at','update');
end $$;
rollback;
select 'PASS: profile rename/stale/duplicate/retry; archive/cap reuse/session revocation; shared tasks/completion/Auth preservation';
