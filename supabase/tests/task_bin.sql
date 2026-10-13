-- LOCAL disposable PostgreSQL only. Never run against a real project.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000401'),('00000000-0000-4000-8000-000000000402');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000411','00000000-0000-4000-8000-000000000401'),('00000000-0000-4000-8000-000000000412','00000000-0000-4000-8000-000000000402');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000401';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000411';
set role authenticated;
select public.task_app_choose_member(null,'Bin Example')->'current'->>'name';
insert into public.tasks(title,notes,priority,due_date,due_time,weekdays) values('Bin ordinary','Preserve exact notes','high','2026-10-13','12:55','{2}');
insert into public.tasks(title,status) values('Bin completed','completed');
do $$ declare a public.tasks;b public.tasks;result jsonb;selections jsonb;when_done timestamptz;who_done text;begin
 select * into a from public.tasks where title='Bin ordinary';select * into b from public.tasks where title='Bin completed';when_done:=b.completed_at;who_done:=b.completed_by_name;
 result:=public.task_app_mutate(a.id,a.updated_at,'delete');assert result->>'deleted_at' is not null;
 select * into a from public.tasks where id=a.id;assert a.deleted_by_name='Bin Example';assert a.deleted_at=statement_timestamp();
 perform public.task_app_mutate(b.id,b.updated_at,'delete');select * into b from public.tasks where id=b.id;
 begin perform public.task_app_bin('purge',jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at)),false);raise exception 'Expected confirmation';exception when check_violation then null;end;
 selections:=jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at),jsonb_build_object('id',b.id,'version','2000-01-01T00:00:00Z'));
 begin perform public.task_app_bin('restore',selections,true);raise exception 'Expected atomic stale rejection';exception when sqlstate 'P0012' then null;end;
 assert (select count(*)=2 from public.tasks where id in(a.id,b.id) and deleted_at is not null);
 selections:=jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at),jsonb_build_object('id',b.id,'version',b.updated_at));
 result:=public.task_app_bin('restore',selections,true);assert jsonb_array_length(result->'ids')=2;
 assert (select notes='Preserve exact notes' and priority='high' and due_date=date '2026-10-13' and due_time=time '12:55' and weekdays='{2}' and deleted_at is null and deleted_by_name is null from public.tasks where id=a.id);
 assert (select status='completed' and completed_at=when_done and completed_by_name=who_done and history_at is null from public.tasks where id=b.id);
 begin perform public.task_app_bin('purge',jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at)),true);raise exception 'Expected active-task rejection';exception when sqlstate 'P0012' then null;end;
 select * into a from public.tasks where id=a.id;perform public.task_app_mutate(a.id,a.updated_at,'delete');
 select * into a from public.tasks where id=a.id;result:=public.task_app_bin('purge',jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at)),true);
 assert not exists(select 1 from public.tasks where id=a.id);
end $$;
-- Completed repeat: deleting cancels its waiting schedule; restore queues one
-- future midnight occurrence. Repeating the stale restore cannot create a second.
insert into public.tasks(title,due_date,repeat_rule) values('Bin repeat completed',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'daily');
do $$ declare a public.tasks;result jsonb;selection jsonb;old_series uuid;begin
 select * into a from public.tasks where title='Bin repeat completed';old_series:=a.series_id;
 perform public.task_app_mutate(a.id,a.updated_at,'status',null,'completed');select * into a from public.tasks where id=a.id;
 perform public.task_app_mutate(a.id,a.updated_at,'delete');select * into a from public.tasks where id=a.id;
 selection:=jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at));
 result:=public.task_app_bin('restore',selection,true);assert result->>'resumed'='1';
 select * into a from public.tasks where id=a.id;assert a.series_id<>old_series and a.repeat_rule='daily' and a.status='completed' and a.history_at is null;
 begin perform public.task_app_bin('restore',selection,true);raise exception 'Expected duplicate restore rejection';exception when sqlstate 'P0012' then null;end;
end $$;
reset role;
do $$ declare a public.tasks;begin
 select * into a from public.tasks where title='Bin repeat completed' and owner_id='00000000-0000-4000-8000-000000000401';
 assert (select count(*)=1 from public.task_repeat_pending where series_id=a.series_id and not cancelled and generated_at is null);
 assert (select due_date>(statement_timestamp() at time zone 'Asia/Kolkata')::date from public.task_repeat_pending where series_id=a.series_id and not cancelled);
 assert not exists(select 1 from public.task_repeat_pending where series_id in(select bin_restarted_from from public.task_series where id=a.series_id) and not cancelled and generated_at is null);
end $$;
-- Already-created next occurrence stays present, stops repeating, then is reused
-- as the restored repeat head instead of creating a duplicate task.
set role authenticated;
insert into public.tasks(title,due_date,repeat_rule) values('Bin repeat generated',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'daily');
do $$ declare a public.tasks;begin select * into a from public.tasks where title='Bin repeat generated';perform public.task_app_mutate(a.id,a.updated_at,'status',null,'completed');end $$;
reset role;
select public.task_app_release_repeats('00000000-0000-4000-8000-000000000401',statement_timestamp()+interval '1 day');
set role authenticated;
do $$ declare parent public.tasks;head public.tasks;before_count bigint;result jsonb;begin
 select * into parent from public.tasks where title='Bin repeat generated' and status='completed';select * into head from public.tasks where id=parent.next_occurrence_id;
 select count(*) into before_count from public.tasks;
 perform public.task_app_mutate(parent.id,parent.updated_at,'delete');
 assert (select repeat_rule='off' and deleted_at is null from public.tasks where id=head.id);
 select * into parent from public.tasks where id=parent.id;
 result:=public.task_app_bin('restore',jsonb_build_array(jsonb_build_object('id',parent.id,'version',parent.updated_at)),true);assert result->>'resumed'='1';
 assert (select count(*)=before_count from public.tasks);assert (select repeat_rule='daily' and status='active' from public.tasks where id=head.id);
 assert (select repeat_rule='off' and status='completed' from public.tasks where id=parent.id);
end $$;
-- Stale deletion must leave the live repeat reservation intact; restoring a
-- monthly task preserves the anchor, and re-deleting/re-restoring resumes once.
insert into public.tasks(title,due_date,repeat_rule) values('Bin monthly resume','2026-01-31','monthly');
do $$ declare a public.tasks;result jsonb;original_series uuid;begin
 select * into a from public.tasks where title='Bin monthly resume';
 perform public.task_app_mutate(a.id,a.updated_at,'status',null,'completed');select * into a from public.tasks where id=a.id;
 result:=public.task_app_mutate(a.id,'2000-01-01T00:00:00Z','delete');assert result->>'conflict'='true';
 assert (select deleted_at is null from public.tasks where id=a.id);
 perform public.task_app_mutate(a.id,a.updated_at,'delete');select * into a from public.tasks where id=a.id;
 original_series:=a.series_id;
 result:=public.task_app_bin('restore',jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at)),true);assert result->>'resumed'='1';
 select * into a from public.tasks where id=a.id;assert a.repeat_anchor_day=31 and a.series_id<>original_series;
 perform public.task_app_mutate(a.id,a.updated_at,'delete');select * into a from public.tasks where id=a.id;
 result:=public.task_app_bin('restore',jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at)),true);assert result->>'resumed'='1';
end $$;
-- A generated successor may be permanently deleted. Restoring its previous
-- completed occurrence must replace that historical reservation, not conflict.
insert into public.tasks(title,due_date,repeat_rule) values('Bin missing generated head',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'daily');
do $$ declare a public.tasks;begin select * into a from public.tasks where title='Bin missing generated head';perform public.task_app_mutate(a.id,a.updated_at,'status',null,'completed');end $$;
reset role;
select public.task_app_release_repeats('00000000-0000-4000-8000-000000000401',statement_timestamp()+interval '1 day');
set role authenticated;
do $$ declare a public.tasks;b public.tasks;result jsonb;begin
 select * into a from public.tasks where title='Bin missing generated head' and status='completed';select * into b from public.tasks where id=a.next_occurrence_id;
 perform public.task_app_mutate(a.id,a.updated_at,'delete');select * into b from public.tasks where id=b.id;
 perform public.task_app_mutate(b.id,b.updated_at,'delete');select * into b from public.tasks where id=b.id;
 perform public.task_app_bin('purge',jsonb_build_array(jsonb_build_object('id',b.id,'version',b.updated_at)),true);
 select * into a from public.tasks where id=a.id;
 result:=public.task_app_bin('restore',jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at)),true);assert result->>'resumed'='1';
end $$;
-- A legacy soft-deleted row can have an uncancelled pending reservation.
-- Restoring it replaces that reservation atomically and keeps a single series.
insert into public.tasks(title,due_date,repeat_rule) values('Bin legacy pending',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'daily');
do $$ declare a public.tasks;begin select * into a from public.tasks where title='Bin legacy pending';perform public.task_app_mutate(a.id,a.updated_at,'status',null,'completed');end $$;
reset role;
update public.tasks set deleted_at=statement_timestamp() where title='Bin legacy pending' and owner_id='00000000-0000-4000-8000-000000000401';
set role authenticated;
do $$ declare a public.tasks;result jsonb;begin
 select * into a from public.tasks where title='Bin legacy pending';
 result:=public.task_app_bin('restore',jsonb_build_array(jsonb_build_object('id',a.id,'version',a.updated_at)),true);assert result->>'resumed'='1';
end $$;
-- Cross-account request and no raw delete/metadata writes.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000402';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000412';
select public.task_app_choose_member(null,'Other Bin Example')->'current'->>'name';
do $$ begin
 assert not exists(select 1 from public.tasks where owner_id='00000000-0000-4000-8000-000000000401');
 begin perform public.task_app_bin('purge','[{"id":"00000000-0000-4000-8000-000000000001","version":"2026-10-13T00:00:00Z"}]',true);raise exception 'Expected owner rejection';exception when sqlstate 'P0012' then null;end;
 begin delete from public.tasks;raise exception 'Expected denied direct DELETE';exception when insufficient_privilege then null;end;
 begin update public.tasks set deleted_at=null;raise exception 'Expected denied direct restore';exception when insufficient_privilege then null;end;
end $$;
select public.task_app_leave_member();
do $$ begin begin perform public.task_app_bin('purge','[{"id":"00000000-0000-4000-8000-000000000001","version":"2026-10-13T00:00:00Z"}]',true);raise exception 'Expected revoked member denied';exception when insufficient_privilege then null;end;end $$;
reset role;
set request.jwt.claim.sub='';
set request.jwt.claim.session_id='';
-- Old History in Bin is retained; ordinary old History still expires.
do $$ declare a public.tasks;n bigint;begin
 select * into a from public.tasks where title='Bin repeat generated' and status='completed' and owner_id='00000000-0000-4000-8000-000000000401';
 update public.tasks set deleted_at=statement_timestamp(),history_at=statement_timestamp()-interval '31 days' where id=a.id;
 perform public.task_app_purge_history();assert exists(select 1 from public.tasks where id=a.id and deleted_at is not null);
 assert (select count(*)=2 from auth.users where id in('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000402'));
end $$;
set role anon;
do $$ begin begin perform public.task_app_bin('purge','[]',true);raise exception 'Expected anon denied';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'Task Bin ownership, atomicity, metadata, retention and repeat checks passed';
