-- DISPOSABLE LOCAL PostgreSQL ONLY. No production task/account writes.
\set ON_ERROR_STOP on
begin;
insert into auth.sessions(id,user_id) values
  ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000094','00000000-0000-4000-8000-000000000002');
do $$ begin
  assert not exists(select * from public.local_members_snapshot except select id,owner_id,title,notes,status,completed_at from public.tasks);
  assert not exists(select 1 from public.tasks where completed_by_member_id is not null or completed_by_name is not null);
  assert not has_table_privilege('anon','public.account_members','select');
  assert not has_table_privilege('authenticated','public.account_members','insert');
  assert not has_table_privilege('authenticated','public.account_member_sessions','select');
  assert not has_table_privilege('service_role','public.account_member_sessions','insert');
  assert not has_function_privilege('authenticated','public.task_app_current_member()','execute');
  assert not has_function_privilege('anon','public.task_app_choose_member(uuid,text)','execute');
  assert not has_column_privilege('authenticated','public.tasks','completed_by_member_id','insert');
  assert not has_column_privilege('authenticated','public.tasks','completed_by_name','update');
end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000091';
set role authenticated;
do $$ declare result jsonb; begin
  assert public.task_app_member_state()->>'current' is null;
  begin insert into public.tasks(title) values('Missing member denied'); raise exception 'Expected member denial';
    exception when insufficient_privilege then null; end;
  result:=public.task_app_choose_member(null,'  Grace  ');
  assert result->'current'->>'name'='Grace';
  assert jsonb_array_length(result->'members')=1;
  assert public.task_app_choose_member(null,'Duplicate retry')->'current'->>'name'='Grace';
  assert (select count(*) from public.account_members)=1;
  insert into public.tasks(title) values('Member completion fixture');
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000092';
do $$ declare result jsonb; begin
  begin perform public.task_app_choose_member(null,'gRaCe'); raise exception 'Expected duplicate denial';
    exception when unique_violation then null; end;
  begin perform public.task_app_choose_member(null,E'Bad\nName'); raise exception 'Expected invalid name';
    exception when check_violation then null; end;
  result:=public.task_app_choose_member(null,'Daniel');
  assert jsonb_array_length(result->'members')=2;
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000093';
do $$ declare grace uuid; begin
  select id into grace from public.account_members where name='Grace';
  perform public.task_app_choose_member(grace,null);
  assert jsonb_array_length(public.task_app_member_state()->'members')=2;
end $$;
-- Grace completes. Database, not client payload, records the member/name/time.
do $$ declare t public.tasks; result jsonb; begin
  select * into t from public.tasks where title='Member completion fixture';
  result:=public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert result->>'completed_by_name'='Grace' and result->>'completed_by_member_id' is not null;
end $$;
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000092';
-- Daniel edits completed task: attribution/time preserved; reopening clears both.
do $$ declare t public.tasks; result jsonb; fields jsonb; begin
  select * into t from public.tasks where title='Member completion fixture';
  fields:=jsonb_build_object('title',t.title,'notes','Edited by Daniel','status','completed','due_date',null,'due_time',null,'priority','medium','category_id',null,'weekdays','[]'::jsonb,'repeat_rule','off');
  result:=public.task_app_mutate(t.id,t.updated_at,'update',fields);
  assert result->>'completed_by_name'='Grace';
  assert (result->>'completed_at')::timestamptz=t.completed_at;
  select * into t from public.tasks where id=t.id;
  result:=public.task_app_mutate(t.id,t.updated_at,'status',null,'active');
  assert result->>'completed_by_name' is null and result->>'completed_by_member_id' is null and result->>'completed_at' is null;
  select * into t from public.tasks where id=t.id;
  result:=public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert result->>'completed_by_name'='Daniel';
  assert result->>'completed_by_member_id'=(public.task_app_member_state()->'current'->>'id');
  insert into public.tasks(title,due_date,repeat_rule) values('Member repeat fixture','2099-01-01','daily');
  select * into t from public.tasks where title='Member repeat fixture';
  result:=public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert result->>'completed_by_name'='Daniel';
  assert (select count(*) from public.tasks where series_id=t.series_id)=1;
end $$;
-- Another account cannot select/read account1 profiles, nor use its session claim.
select set_config('test.grace_member',(select id::text from public.account_members where name='Grace'),true);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000094';
do $$ declare stolen uuid; begin
  assert (select count(*) from public.account_members)=0;
  assert jsonb_array_length(public.task_app_member_state()->'members')=0;
  begin perform public.task_app_choose_member(current_setting('test.grace_member')::uuid,null); raise exception 'Expected cross-account denial';
    exception when insufficient_privilege then null; end;
  perform public.task_app_choose_member(null,'Other account');
end $$;
reset role;
do $$ declare t public.tasks; successor public.tasks; old_name text; begin
  select * into t from public.tasks where title='Member repeat fixture'; old_name:=t.completed_by_name;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.session_id','',true);
  assert public.task_app_release_repeats(t.owner_id,'2099-01-01T18:30Z')=1;
  select * into successor from public.tasks where id=t.next_occurrence_id;
  assert successor.completed_by_member_id is null and successor.completed_by_name is null;
  assert (select completed_by_name=old_name and history_at is not null from public.tasks where id=t.id);
end $$;
-- Admin changes to a profile do not rewrite a completion's snapshot.
update public.account_members set name='Daniel renamed' where name='Daniel';
do $$ begin assert (select completed_by_name='Daniel' from public.tasks where title='Member completion fixture'); end $$;
delete from auth.sessions where id='00000000-0000-4000-8000-000000000092';
do $$ begin assert not exists(select 1 from public.account_member_sessions where session_id='00000000-0000-4000-8000-000000000092'); end $$;
rollback;
select 'PASS: members RLS/grants, session binding/reuse/retry, completion/edit/reopen/history/worker/legacy preservation';

-- Committed isolated fixtures for the following concurrency test.
insert into auth.users(id) values('00000000-0000-4000-8000-000000000080');
insert into auth.sessions(id,user_id) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '00000000-0000-4000-8000-000000000080' from generate_series(81,92) n;
insert into public.account_members(owner_id,name) select '00000000-0000-4000-8000-000000000080',
  'Existing '||n from generate_series(1,9) n;
