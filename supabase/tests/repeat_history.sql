-- DISPOSABLE LOCAL PostgreSQL ONLY. No hosted accounts or records.
\set ON_ERROR_STOP on
do $$ begin
  assert not has_function_privilege('service_role','public.task_app_purge_history()','execute');
  assert public.task_app_next_date('monthly','2027-01-31',null,'{}',31::smallint,'2027-01-31T00:00Z')='2027-02-28';
  assert public.task_app_next_date('monthly','2027-02-28',null,'{}',31::smallint,'2027-02-28T00:00Z')='2027-03-31';
  assert public.task_app_next_date('monthly','2028-01-31',null,'{}',31::smallint,'2028-01-31T00:00Z')='2028-02-29';
  assert public.task_app_next_date('monthly','2027-01-31',null,'{}',31::smallint,'2027-04-01T00:00Z')='2027-04-30';
  assert public.task_app_next_date('weekly','2026-10-11','10:00','{0,3}',null,'2026-10-11T05:00Z')='2026-10-14';
  assert public.task_app_next_date('weekly','2026-10-11','10:00','{0,3}',null,'2026-10-20T05:00Z')='2026-10-21';
  assert public.task_app_next_date('weekly','2026-10-11','10:00','{0,3}',null,'2026-10-14T04:29:59Z')='2026-10-14';
  assert public.task_app_next_date('weekly','2026-10-11','10:00','{0,3}',null,'2026-10-14T04:30:00Z')='2026-10-18';
  assert public.task_app_next_date('daily','2026-10-11','23:00','{}',null,'2026-10-12T17:29:59Z')='2026-10-12';
  assert public.task_app_next_date('daily','2026-10-11',null,'{}',null,'2026-10-12T18:30:00Z')='2026-10-14';
  assert public.task_app_next_date('daily','2026-10-20',null,'{}',null,'2026-10-12T00:00Z')='2026-10-21';
end $$;
select 'PASS: calendar anchors, leap years, India midnight, multiple weekdays, exact deadline, early/late completion';

set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set role authenticated;
insert into public.tasks(title,notes,due_date,due_time,repeat_rule,weekdays,priority)
  values('Repeat SQL fixture','Retain these notes','2099-01-31','10:00','monthly','{}','high');
do $$ declare t public.tasks; n public.tasks; response jsonb; count_before int;
begin
  select * into t from public.tasks where title='Repeat SQL fixture';
  assert t.series_id is not null and t.repeat_anchor_day=31;
  begin
    update public.tasks set status='completed' where id=t.id;
    raise exception 'Direct update unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  response:=public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert response->>'status'='completed' and response->>'next_occurrence_id' is not null;
  select * into t from public.tasks where id=t.id;
  select * into n from public.tasks where id=t.next_occurrence_id;
  assert n.status='active' and n.due_date='2099-02-28' and n.repeat_anchor_day=31;
  assert n.series_id=t.series_id and n.occurrence_number=1 and n.notes=t.notes and n.priority='high';
  assert t.history_at='2099-02-28T04:30Z' and t.history_at>statement_timestamp();
  select count(*) into count_before from public.tasks where series_id=t.series_id;
  perform public.task_app_mutate(t.id,t.updated_at,'status',null,'active');
  select * into t from public.tasks where id=t.id;
  perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  assert (select count(*) from public.tasks where series_id=t.series_id)=count_before;
  assert (select id from public.tasks where id=n.id)=n.id;
  select * into t from public.tasks where id=t.id;
  response:=public.task_app_mutate(t.id,t.updated_at-interval '1 second','status',null,'active');
  assert response->>'conflict'='true';
  -- This-only notes do not change successor.
  response:=public.task_app_mutate(t.id,t.updated_at,'update',jsonb_build_object(
    'title',t.title,'notes','Only this','status',t.status,'due_date',t.due_date,'due_time',t.due_time,
    'priority',t.priority,'category_id',t.category_id,'weekdays',to_jsonb(t.weekdays),'repeat_rule',t.repeat_rule));
  assert (select notes from public.tasks where id=n.id)='Retain these notes';
  select * into t from public.tasks where id=t.id;
  response:=public.task_app_mutate(t.id,t.updated_at,'update',jsonb_build_object(
    'title',t.title,'notes','Future details','status',t.status,'due_date',t.due_date,'due_time',t.due_time,
    'priority','medium','category_id',t.category_id,'weekdays',to_jsonb(t.weekdays),'repeat_rule',t.repeat_rule),null,'future');
  assert response->>'conflict' is null;
  assert (select notes from public.tasks where id=n.id)='Future details';
  assert (select due_date from public.tasks where id=n.id)='2099-02-28';
  -- Ownership and administrator-only maintenance enforcement.
  begin perform public.task_app_purge_history(); raise exception 'User purge unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin insert into public.tasks(title,series_id) values('Managed field',t.series_id);
    raise exception 'Managed metadata insert unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin insert into public.tasks(title,due_date,repeat_rule,weekdays)
    values('Wrong weekday','2099-01-31','weekly','{1}');
    raise exception 'Weekly mismatch unexpectedly allowed';
  exception when check_violation then null; end;
end $$;
reset role;
select 'PASS: atomic successor, copied details, last-day anchor, reopen idempotency, stale denial, edit scopes, managed grants';

-- Another owner cannot see or mutate this series, even using exact known IDs.
select id as test_task_id,updated_at as test_task_version,series_id as test_series_id from public.tasks where title='Repeat SQL fixture' and occurrence_number=0 \gset
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set role authenticated;
select public.task_app_mutate(:'test_task_id',:'test_task_version','delete') is null as other_mutation_denied \gset
select count(*)=0 as other_read_denied from public.tasks where id=:'test_task_id' \gset
select count(*)=0 as other_series_denied from public.task_series where id=:'test_series_id' \gset
reset role;
\if :other_mutation_denied
\else
  \quit 1
\endif
\if :other_read_denied
\else
  \quit 1
\endif
\if :other_series_denied
\else
  \quit 1
\endif
set role anon;
do $$ begin
  begin perform public.task_app_mutate(gen_random_uuid(),now(),'delete'); raise exception 'Anon mutation allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.task_app_purge_history(); raise exception 'Anon purge allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: cross-account and anonymous denial';

-- Admin simulates retention age. No user can alter history_at directly.
update public.tasks set history_at=statement_timestamp()-interval '30 days' where id=:'test_task_id';
insert into public.tasks(owner_id,title,due_date,repeat_rule)
  values('00000000-0000-4000-8000-000000000001','Retained recent history','2099-01-01','daily');
update public.tasks set status='completed' where title='Retained recent history';
update public.tasks set history_at=statement_timestamp()-interval '29 days' where title='Retained recent history' and status='completed';
insert into public.tasks(owner_id,title,due_date,repeat_rule)
  values('00000000-0000-4000-8000-000000000001','Retained reopened history','2099-01-01','daily');
update public.tasks set status='completed' where title='Retained reopened history';
update public.tasks set status='active',history_at=statement_timestamp()-interval '45 days'
  where title='Retained reopened history' and occurrence_number=0;
do $$ declare removed bigint;
begin
  removed:=public.task_app_purge_history(); assert removed=1;
  assert exists(select 1 from public.tasks where title='Repeat SQL fixture' and status='active');
  assert exists(select 1 from public.tasks where title='Retained recent history' and status='completed');
  assert exists(select 1 from public.tasks where title='Retained reopened history' and occurrence_number=0);
  assert exists(select 1 from public.task_series where id in(select series_id from public.tasks));
end $$;
select 'PASS: 30-day purge preserves recent history, active/reopened tasks, successors and series';
