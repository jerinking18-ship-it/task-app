-- LOCAL DISPOSABLE PostgreSQL ONLY. Never run against Supabase.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000601'),('00000000-0000-4000-8000-000000000602');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000611','00000000-0000-4000-8000-000000000601'),('00000000-0000-4000-8000-000000000612','00000000-0000-4000-8000-000000000602');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000601';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000611';
set role authenticated;
select public.task_app_choose_member(null,'Clear Example')->'current'->>'name';
insert into public.tasks(title,status) values('Clear ordinary','completed'),('Clear active','active'),('Clear bin','completed'),('Clear history','completed');
insert into public.tasks(title,due_date,repeat_rule) values('Clear repeating',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'daily');
do $$ declare t public.tasks;s jsonb;begin
 select * into t from public.tasks where title='Clear bin';perform public.task_app_mutate(t.id,t.updated_at,'delete');
 select * into t from public.tasks where title='Clear repeating';perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
end $$;
reset role;
update public.tasks set next_occurrence_id=gen_random_uuid(),history_at=statement_timestamp()-interval '1 day' where title='Clear history' and owner_id='00000000-0000-4000-8000-000000000601';
set role authenticated;
do $$ declare s jsonb;result jsonb;begin
 s:=public.task_app_completed('preview');assert (s->>'count')::integer=2;
 begin perform public.task_app_completed('purge',2,s->>'snapshot',false);raise exception 'Expected explicit confirmation';exception when check_violation then null;end;
 begin perform public.task_app_completed('purge',3,s->>'snapshot',true);raise exception 'Expected stale count';exception when sqlstate 'P0013' then null;end;
 begin perform public.task_app_completed('purge',2,repeat('f',32),true);raise exception 'Expected stale version';exception when sqlstate 'P0013' then null;end;
 assert exists(select 1 from public.tasks where title='Clear ordinary');
 insert into public.tasks(title,status) values('Clear new completion','completed');
 begin perform public.task_app_completed('purge',2,s->>'snapshot',true);raise exception 'Expected changed set';exception when sqlstate 'P0013' then null;end;
 s:=public.task_app_completed('preview');result:=public.task_app_completed('purge',(s->>'count')::bigint,s->>'snapshot',true);
 assert result->>'deleted'='3';assert result->>'snapshot'=s->>'snapshot';
 assert not exists(select 1 from public.tasks where title in('Clear ordinary','Clear repeating','Clear new completion'));
 assert (select count(*)=3 from public.tasks where title in('Clear active','Clear bin','Clear history'));
 s:=public.task_app_completed('preview');assert s->>'count'='0';
 begin perform public.task_app_completed('purge',3,result->>'snapshot',true);raise exception 'Expected replay rejection';exception when sqlstate 'P0013' then null;end;
 begin delete from public.tasks;raise exception 'Expected raw DELETE denied';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare q public.task_repeat_pending;n bigint;begin
 select * into q from public.task_repeat_pending where owner_id='00000000-0000-4000-8000-000000000601' and payload->>'title'='Clear repeating';
 assert q.source_task_id is null and not q.cancelled and q.generated_at is null;
 assert (select stopped_at is null from public.task_series where id=q.series_id);
 n:=public.task_app_release_repeats(q.owner_id,statement_timestamp()+interval '2 days');assert n=1;
 assert (select status='active' and repeat_rule='daily' from public.tasks where id=q.id);
 assert not exists(select 1 from public.tasks where title='Clear ordinary');
end $$;
-- Bin still stops repeats; its purge cascades the cancelled reservation.
set role authenticated;
insert into public.tasks(title,due_date,repeat_rule) values('Clear bin repeat',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'daily');
do $$ declare t public.tasks;series uuid;begin
 select * into t from public.tasks where title='Clear bin repeat';series:=t.series_id;
 perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');select * into t from public.tasks where id=t.id;
 perform public.task_app_mutate(t.id,t.updated_at,'delete');select * into t from public.tasks where id=t.id;
 perform public.task_app_bin('purge',jsonb_build_array(jsonb_build_object('id',t.id,'version',t.updated_at)),true);
end $$;
reset role;
do $$ begin
 assert not exists(select 1 from public.task_repeat_pending where payload->>'title'='Clear bin repeat');
 assert not exists(select 1 from public.tasks where title='Clear bin repeat');
end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000602';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000612';
set role authenticated;
select public.task_app_choose_member(null,'Other Clear Example')->'current'->>'name';
insert into public.tasks(title,status) values('Other clear completed','completed');
do $$ declare s jsonb;begin
 s:=public.task_app_completed('preview');assert s->>'count'='1';perform public.task_app_completed('purge',1,s->>'snapshot',true);
 assert not exists(select 1 from public.tasks where title='Other clear completed');
end $$;
select public.task_app_leave_member();
do $$ begin begin perform public.task_app_completed('preview');raise exception 'Expected revoked member denied';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$ begin assert (select count(*)=3 from public.tasks where owner_id='00000000-0000-4000-8000-000000000601' and title in('Clear active','Clear bin','Clear history')); end $$;
set role anon;
do $$ begin begin perform public.task_app_completed('preview');raise exception 'Expected anon denied';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'Completed clear ownership, atomicity, physical deletion and repeat/Bin separation checks passed';
