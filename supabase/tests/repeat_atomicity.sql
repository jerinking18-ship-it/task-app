-- Disposable local database only, after repeat_history.sql.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
insert into public.tasks(owner_id,title,due_date,repeat_rule,notes)
  values('00000000-0000-4000-8000-000000000001','Atomic failure fixture','2099-01-01','daily','Keep intact');
alter table public.tasks add constraint local_fail_successor
  check (title<>'Atomic failure fixture' or occurrence_number=0);
set role authenticated;
do $$ declare t public.tasks;
begin
  select * into t from public.tasks where title='Atomic failure fixture';
  begin
    perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
    raise exception 'Successor failure not rolled back';
  exception when check_violation then null; end;
  assert (select status from public.tasks where id=t.id)='active';
  assert (select next_occurrence_id from public.tasks where id=t.id) is null;
  assert (select count(*) from public.tasks where series_id=t.series_id)=1;
  begin
    perform public.task_app_mutate(t.id,null,'delete');
    raise exception 'Missing version accepted';
  exception when check_violation then null; end;
end $$;
reset role;
alter table public.tasks drop constraint local_fail_successor;
select 'PASS: failed successor rolls back completion and all metadata; missing version denied';

insert into public.tasks(owner_id,title,due_date,repeat_rule)
  values('00000000-0000-4000-8000-000000000001','Series conflict fixture','2099-01-31','monthly');
update public.tasks set status='completed' where title='Series conflict fixture';
-- A later independent device edit changes the pending occurrence only.
update public.tasks set notes='Another device changed this' where title='Series conflict fixture' and status='active';
set role authenticated;
do $$ declare t public.tasks; n public.tasks; response jsonb; payload jsonb; latest_version timestamptz;
begin
  select * into t from public.tasks where title='Series conflict fixture' and occurrence_number=0;
  select * into n from public.tasks where id=t.next_occurrence_id;
  payload:=jsonb_build_object('title',t.title,'notes','Reviewed draft','status',t.status,
    'due_date',t.due_date,'due_time',t.due_time,'priority',t.priority,'category_id',t.category_id,
    'weekdays',to_jsonb(t.weekdays),'repeat_rule',t.repeat_rule);
  response:=public.task_app_mutate(t.id,t.updated_at,'update',payload,null,'future',t.updated_at);
  assert response->>'conflict'='true';
  assert response->'future'->0->>'notes'='Another device changed this';
  assert (select notes from public.tasks where id=n.id)='Another device changed this';
  latest_version:=(response->>'series_version')::timestamptz;
  -- Explicit review can use the new series version; this does not require
  -- overwriting the target first or repeatedly failing on an unchanged target.
  response:=public.task_app_mutate(t.id,t.updated_at,'update',payload,null,'future',latest_version);
  assert response->>'conflict' is null;
  assert (select notes from public.tasks where id=n.id)='Reviewed draft';
  select * into t from public.tasks where id=t.id;
  payload:=payload||jsonb_build_object('repeat_rule','off');
  response:=public.task_app_mutate(t.id,t.updated_at,'update',payload,null,'future',(response->>'series_version')::timestamptz);
  assert (select repeat_rule from public.tasks where id=n.id)='off';
  select * into n from public.tasks where id=n.id;
  perform public.task_app_mutate(n.id,n.updated_at,'status',null,'completed');
  assert (select count(*) from public.tasks where series_id=t.series_id)=2;
end $$;
reset role;
select 'PASS: future edit conflict snapshot/review, retry with current series version, stopping repeat';

-- A reopened middle occurrence retains its successor, but future schedule edits
-- must give it a valid new weekday without modifying completed history.
insert into public.tasks(owner_id,title,due_date,repeat_rule)
  values('00000000-0000-4000-8000-000000000001','Reopened future fixture','2099-01-01','daily');
set role authenticated;
do $$ declare t public.tasks; middle public.tasks; past public.tasks; head public.tasks;
  payload jsonb; response jsonb; version timestamptz; weekday smallint;
begin
  select * into t from public.tasks where title='Reopened future fixture';
  perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
  select * into t from public.tasks where id=t.id;
  select * into middle from public.tasks where id=t.next_occurrence_id;
  perform public.task_app_mutate(middle.id,middle.updated_at,'status',null,'completed');
  select * into middle from public.tasks where id=middle.id;
  select * into past from public.tasks where id=middle.next_occurrence_id;
  perform public.task_app_mutate(past.id,past.updated_at,'status',null,'completed');
  select * into past from public.tasks where id=past.id;
  select * into head from public.tasks where id=past.next_occurrence_id;
  perform public.task_app_mutate(middle.id,middle.updated_at,'status',null,'active');
  select max(updated_at) into version from public.tasks where series_id=t.series_id;
  weekday:=extract(dow from t.due_date)::smallint;
  payload:=jsonb_build_object('title',t.title,'notes','Revised weekly schedule','status',t.status,
    'due_date',t.due_date,'due_time',t.due_time,'priority',t.priority,'category_id',t.category_id,
    'weekdays',jsonb_build_array(weekday),'repeat_rule','weekly');
  response:=public.task_app_mutate(t.id,t.updated_at,'update',payload,null,'future',version);
  assert response->>'conflict' is null;
  assert (select due_date from public.tasks where id=middle.id)=t.due_date+7;
  assert (select next_occurrence_id from public.tasks where id=middle.id)=past.id;
  assert (select due_date from public.tasks where id=past.id)=past.due_date;
  assert (select notes from public.tasks where id=past.id) is not distinct from past.notes;
  assert (select due_date from public.tasks where id=head.id)=t.due_date+21;
  select * into middle from public.tasks where id=middle.id;
  perform public.task_app_mutate(middle.id,middle.updated_at,'status',null,'completed');
  assert (select count(*) from public.tasks where series_id=t.series_id)=4;
end $$;
reset role;
select 'PASS: future weekly edits align reopened middle and pending head, retain completed history and successor links';
