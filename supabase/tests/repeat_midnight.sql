-- DISPOSABLE LOCAL PostgreSQL ONLY. Clock injection is admin-only, never an API input.
\set ON_ERROR_STOP on
begin;
do $$ begin
  assert not has_table_privilege('authenticated','public.task_repeat_pending','select');
  assert not has_table_privilege('service_role','public.task_repeat_pending','insert');
  assert not has_function_privilege('authenticated','public.task_app_release_repeats(uuid,timestamptz)','execute');
  assert not has_function_privilege('authenticated','public.task_app_release_scheduled_repeats()','execute');
  assert not has_function_privilege('anon','public.task_app_release_my_repeats()','execute');
  assert not has_function_privilege('authenticated','public.task_app_mutate_task(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute');
  assert not has_column_privilege('authenticated','public.tasks','available_at','insert');
  assert has_function_privilege('authenticated','public.task_app_release_my_repeats()','execute');
  assert public.task_app_next_date('daily','2026-10-11','23:00','{}',null,'2026-10-12T04:00Z')='2026-10-13';
  assert public.task_app_next_date('weekly','2026-10-11','10:00','{0,3}',null,'2026-10-14T04:29Z')='2026-10-18';
  assert public.task_app_next_date('weekly','2026-10-11','10:00','{0,3}',null,'2026-10-13T18:29:59Z')='2026-10-14';
  assert public.task_app_next_date('weekly','2026-10-11','10:00','{0,3}',null,'2026-10-13T18:30Z')='2026-10-18';
  assert public.task_app_next_date('monthly','2027-01-31','10:00','{}',31::smallint,'2027-01-31T00:00Z')='2027-02-28';
  assert public.task_app_next_date('monthly','2027-02-28','10:00','{}',31::smallint,'2027-02-28T00:00Z')='2027-03-31';
  assert public.task_app_next_date('monthly','2028-01-31',null,'{}',31::smallint,'2028-01-31T00:00Z')='2028-02-29';
  assert public.task_app_next_date('monthly','2027-01-31','10:00','{}',31::smallint,'2027-02-28T00:00Z')='2027-03-31';
  assert public.task_app_next_date('daily','2099-01-01','10:00','{}',null,statement_timestamp())='2099-01-02';
  -- Migration retains every task/detail/ID and does not hide first occurrences.
  assert not exists(select * from public.local_midnight_snapshot except
    select id,owner_id,title,notes,status,due_date,due_time,priority,category_id,weekdays,
      repeat_rule,repeat_anchor_day,series_id,occurrence_number,created_at
    from public.tasks where title='Midnight legacy transition');
  assert (select available_at from public.tasks where title='Midnight legacy transition' and status='active')='2099-01-01T18:30Z';
  assert (select history_at from public.tasks where title='Midnight legacy transition' and status='completed')='2099-01-01T18:30Z';
  assert (select available_at is null from public.tasks where title='Midnight first future task');
end $$;
select 'PASS: midnight calendar/anchors, permissions and lossless legacy transition';

set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set role authenticated;
insert into public.tasks(title,notes,due_date,due_time,repeat_rule,priority)
values('Midnight queued fixture','Keep these notes','2099-01-01','10:00','daily','high');
do $$ declare t public.tasks; result jsonb;
begin
  select * into t from public.tasks where title='Midnight queued fixture';
  result:=public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert result->>'next_occurrence_id' is not null;
  assert result->>'history_at' is null;
  assert (select count(*) from public.tasks where series_id=t.series_id)=1;
  select * into t from public.tasks where id=t.id;
  perform public.task_app_mutate(t.id,t.updated_at,'status',null,'active');
  select * into t from public.tasks where id=t.id;
  perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert (select count(*) from public.tasks where series_id=t.series_id)=1;
  -- Account-scoped catch-up before the scheduled day cannot create it early.
  assert public.task_app_release_my_repeats()=0;
end $$;
reset role;
do $$ declare t public.tasks; n public.tasks; p public.task_repeat_pending;
begin
  select * into t from public.tasks where title='Midnight queued fixture';
  select * into p from public.task_repeat_pending where source_task_id=t.id;
  assert p.due_date='2099-01-02' and p.id=t.next_occurrence_id;
  assert (select count(*) from public.task_repeat_pending where source_task_id=t.id)=1;
  assert public.task_app_release_repeats(t.owner_id,'2099-01-01T18:29:59.999Z')=0;
  assert (select history_at is null from public.tasks where id=t.id);
  assert public.task_app_release_repeats('00000000-0000-4000-8000-000000000002','2099-01-01T18:30Z')=0;
  assert public.task_app_release_repeats(t.owner_id,'2099-01-01T18:30Z')=1;
  select * into n from public.tasks where id=p.id;
  assert n.status='active' and n.due_date='2099-01-02' and n.due_time='10:00';
  assert n.title=t.title and n.notes=t.notes and n.priority=t.priority and n.weekdays=t.weekdays;
  assert n.series_id=t.series_id and n.occurrence_number=1 and n.available_at='2099-01-01T18:30Z';
  assert (select history_at from public.tasks where id=t.id)='2099-01-01T18:30Z';
  assert public.task_app_release_repeats(t.owner_id,'2099-01-01T18:30Z')=0;
  assert (select count(*) from public.tasks where series_id=t.series_id)=2;
end $$;
select 'PASS: no immediate task, reopen/recompletion, exact India midnight, copied fields, ownership and retry idempotence';

set role authenticated;
insert into public.tasks(title,notes,due_date,due_time,repeat_rule,priority)
values('Midnight edit fixture','Initial future snapshot','2099-01-31','10:00','monthly','high');
do $$ declare t public.tasks; result jsonb; payload jsonb;
begin
  select * into t from public.tasks where title='Midnight edit fixture';
  perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  select * into t from public.tasks where id=t.id;
  payload:=jsonb_build_object('title',t.title,'notes','Only this occurrence','status',t.status,
    'due_date',t.due_date,'due_time',t.due_time,'priority',t.priority,'category_id',t.category_id,
    'weekdays',to_jsonb(t.weekdays),'repeat_rule',t.repeat_rule);
  result:=public.task_app_mutate(t.id,t.updated_at,'update',payload);
  select * into t from public.tasks where id=t.id;
  payload:=payload||jsonb_build_object('notes','Changed future snapshot','priority','low');
  result:=public.task_app_mutate(t.id,t.updated_at,'update',payload,null,'future',(result->>'series_version')::timestamptz);
  assert result->>'conflict' is null;
end $$;
reset role;
do $$ declare t public.tasks; p public.task_repeat_pending; result jsonb; payload jsonb;
begin
  select * into t from public.tasks where title='Midnight edit fixture';
  select * into p from public.task_repeat_pending where source_task_id=t.id;
  assert p.payload->>'notes'='Changed future snapshot' and p.payload->>'priority'='low';
  assert p.due_date='2099-02-28' and p.payload->>'repeat_anchor_day'='31';
  -- Stale conflict includes the pending occurrence for review, without granting
  -- clients direct queue access or allowing a worker-clock parameter.
  result:=public.task_app_mutate(t.id,t.updated_at-interval '1 second','update','{}',null,'future',t.updated_at);
  assert result->>'conflict'='true';
  assert result->'future'->0->>'notes'='Changed future snapshot';
  payload:=jsonb_build_object('title',t.title,'notes',t.notes,'status',t.status,
    'due_date',t.due_date,'due_time',t.due_time,'priority',t.priority,'category_id',t.category_id,
    'weekdays',to_jsonb(t.weekdays),'repeat_rule','off');
  result:=public.task_app_mutate(t.id,t.updated_at,'update',payload,null,'future',t.updated_at);
  assert (select cancelled from public.task_repeat_pending where id=p.id);
  assert public.task_app_release_repeats(t.owner_id,'2099-02-27T18:30Z')=0;
  assert not exists(select 1 from public.tasks where id=p.id);
  select * into t from public.tasks where id=t.id;
  payload:=payload||jsonb_build_object('repeat_rule','weekly','weekdays',jsonb_build_array(extract(dow from t.due_date)::smallint));
  result:=public.task_app_mutate(t.id,t.updated_at,'update',payload,null,'future',(result->>'series_version')::timestamptz);
  assert not(select cancelled from public.task_repeat_pending where id=p.id);
  assert (select due_date from public.task_repeat_pending where id=p.id)=t.due_date+7;
end $$;
select 'PASS: this/future editing, pending conflict review, monthly anchor, Stop repeat and reactivation';

-- Queue failure rolls back completion. Worker failure leaves completed task and
-- schedule intact for a safe retry; it cannot archive without inserting a task.
alter table public.task_repeat_pending add constraint local_queue_fail check(payload->>'title'<>'Midnight atomic fixture');
insert into public.tasks(owner_id,title,due_date,repeat_rule)
values('00000000-0000-4000-8000-000000000001','Midnight atomic fixture','2099-01-01','daily');
do $$ declare t public.tasks;
begin
  select * into t from public.tasks where title='Midnight atomic fixture';
  begin perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
    raise exception 'Queue failure did not roll back'; exception when check_violation then null; end;
  assert (select status from public.tasks where id=t.id)='active';
  assert (select next_occurrence_id is null from public.tasks where id=t.id);
end $$;
alter table public.task_repeat_pending drop constraint local_queue_fail;
update public.tasks set status='completed' where title='Midnight atomic fixture';
alter table public.tasks add constraint local_worker_fail check(title<>'Midnight atomic fixture' or occurrence_number=0);
do $$ declare t public.tasks;
begin
  select * into t from public.tasks where title='Midnight atomic fixture';
  begin perform public.task_app_release_repeats(t.owner_id,'2099-01-01T18:30Z');
    raise exception 'Worker failure did not roll back'; exception when check_violation then null; end;
  assert (select status from public.tasks where id=t.id)='completed';
  assert (select history_at is null from public.tasks where id=t.id);
  assert (select generated_at is null from public.task_repeat_pending where source_task_id=t.id);
  assert (select count(*) from public.tasks where series_id=t.series_id)=1;
end $$;
alter table public.tasks drop constraint local_worker_fail;
select 'PASS: completion queue and midnight insert/History transitions roll back atomically';

-- Owner isolation for mutation and due release.
select id as midnight_id, updated_at as midnight_version from public.tasks where title='Midnight atomic fixture' \gset
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set role authenticated;
select public.task_app_mutate(:'midnight_id',:'midnight_version','delete') is null as midnight_other_denied \gset
do $$ begin
  assert public.task_app_release_my_repeats()=0;
  begin perform public.task_app_release_scheduled_repeats(); raise exception 'Admin worker exposed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\if :midnight_other_denied
\else
  \quit 1
\endif
select 'PASS: other account and privileged scheduler denial';
rollback;

-- Separate transaction: full monthly/weekly generation and retention, without
-- changing any legacy fixture state used by the concurrency checks.
begin;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
insert into public.tasks(owner_id,title,due_date,due_time,repeat_rule,weekdays)
values('00000000-0000-4000-8000-000000000001','Midnight monthly generation','2099-01-31','10:00','monthly','{}'),
 ('00000000-0000-4000-8000-000000000001','Midnight weekly generation','2099-01-04','10:00','weekly','{0,3}');
update public.tasks set status='completed' where title in('Midnight monthly generation','Midnight weekly generation');
do $$ declare t public.tasks; n public.tasks;
begin
  select * into t from public.tasks where title='Midnight weekly generation';
  assert (select due_date from public.task_repeat_pending where source_task_id=t.id)='2099-01-07';
  perform public.task_app_release_repeats(t.owner_id,'2099-01-06T18:30Z');
  select * into n from public.tasks where id=t.next_occurrence_id;
  assert n.due_date='2099-01-07' and n.weekdays='{0,3}' and n.due_time='10:00';
  select * into t from public.tasks where title='Midnight monthly generation';
  perform public.task_app_release_repeats(t.owner_id,'2099-02-27T18:30Z');
  select * into n from public.tasks where id=t.next_occurrence_id;
  assert n.due_date='2099-02-28' and n.repeat_anchor_day=31 and n.due_time='10:00';
  update public.tasks set status='completed' where id=n.id;
  assert (select due_date from public.task_repeat_pending where source_task_id=n.id)='2099-03-31';
  -- An outage recovery creates one waiting task, with a full retention window
  -- beginning on actual release, not backdated into immediate deletion.
  perform public.task_app_release_repeats(t.owner_id,'2099-04-01T00:00Z');
  assert (select history_at from public.tasks where id=n.id)='2099-04-01T00:00Z';
  assert (select count(*) from public.tasks where series_id=t.series_id)=3;
  -- Retention preserves both the active next task and internal series metadata.
  update public.tasks set history_at=statement_timestamp()-interval '30 days' where id=t.id;
  perform public.task_app_purge_history();
  assert not exists(select 1 from public.tasks where id=t.id);
  assert not exists(select 1 from public.task_repeat_pending where source_task_id=t.id);
  assert exists(select 1 from public.tasks where series_id=t.series_id and status='active');
  assert exists(select 1 from public.task_series where id=t.series_id);
end $$;
select 'PASS: weekly/monthly midnight creation, retained 31st anchor, outage catch-up and 30-day queue/History retention';
rollback;
