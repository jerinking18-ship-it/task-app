-- DISPOSABLE PostgreSQL ONLY. Never run fixtures against hosted Supabase.
\set ON_ERROR_STOP on
begin;
do $$begin
 assert not exists((select * from public.tasks except select * from public.local_template_bin_tasks) union all (select * from public.local_template_bin_tasks except select * from public.tasks));
 assert not exists((select to_jsonb(t)-'deleted_at'-'deleted_by_member_id'-'deleted_by_name' from public.task_templates t except select payload from public.local_template_bin_templates) union all (select payload from public.local_template_bin_templates except select to_jsonb(t)-'deleted_at'-'deleted_by_member_id'-'deleted_by_name' from public.task_templates t));
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001071';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001073';set role authenticated;
do $$declare t public.task_templates;r jsonb;begin
 select * into t from public.task_templates where id='00000000-0000-4000-8000-000000001081';
 begin perform public.task_app_remove_template(t.id,t.updated_at,false);raise exception 'Expected confirmation';exception when check_violation then null;end;
 begin perform public.task_app_remove_template(t.id,t.updated_at-interval '1 day',true);raise exception 'Expected stale rejected';exception when sqlstate 'P0013' then null;end;
 r:=public.task_app_remove_template(t.id,t.updated_at,true);assert r->>'id'=t.id::text;assert (r->>'updated_at')::timestamptz>t.updated_at;
 assert not exists(select 1 from public.task_templates where id=t.id);
 r:=public.task_app_deleted_templates();assert jsonb_array_length(r)=1;assert r->0->>'name'=t.name;assert r->0->'items'=t.items;assert r->0->>'deleted_by_name'='Template Bin Daniel';
 assert (select notes from public.tasks where id=t.id)='A task previously created from this template';
 begin perform public.task_app_save_template(t.id,null,t.name,t.items);raise exception 'Expected create retry not resurrect';exception when sqlstate 'P0013' then null;end;
 begin perform public.task_app_save_template(t.id,t.updated_at,t.name,t.items);raise exception 'Expected stale edit not resurrect';exception when sqlstate 'P0013' then null;end;
 begin update public.task_templates set deleted_at=null;raise exception 'Expected direct writes denied';exception when insufficient_privilege then null;end;
end$$;
-- Same-account selected members share the Bin; unrelated accounts cannot access it.
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001075';
select public.task_app_choose_member(null,'Template Bin Grace')->'current'->>'name';
do $$begin assert jsonb_array_length(public.task_app_deleted_templates())=1;end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001072';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001074';
do $$begin begin perform public.task_app_deleted_templates();raise exception 'Expected unselected denied';exception when insufficient_privilege then null;end;end$$;
select public.task_app_choose_member(null,'Template Bin Foreign')->'current'->>'name';
do $$begin
 assert jsonb_array_length(public.task_app_deleted_templates())=0;
 begin perform public.task_app_bin_items('purge','[{"kind":"template","id":"00000000-0000-4000-8000-000000001081","version":"2026-10-14T00:00:00Z"}]',true);raise exception 'Expected foreign denied';exception when sqlstate 'P0012' then null;end;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001071';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001073';
do $$declare r jsonb;v timestamptz;t public.tasks;selection jsonb;begin
 r:=public.task_app_deleted_templates()->0;v:=(r->>'updated_at')::timestamptz;
 perform public.task_app_bin_items('restore',jsonb_build_array(jsonb_build_object('kind','template','id',r->>'id','version',v)),true);
 assert (select items from public.task_templates where id=(r->>'id')::uuid)=r->'items';
 assert (select created_at from public.task_templates where id=(r->>'id')::uuid)=(r->>'created_at')::timestamptz;
 begin perform public.task_app_bin_items('restore',jsonb_build_array(jsonb_build_object('kind','template','id',r->>'id','version',v)),true);raise exception 'Expected stale restore denied';exception when sqlstate 'P0012' then null;end;
 select updated_at into v from public.task_templates where id=(r->>'id')::uuid;perform public.task_app_remove_template((r->>'id')::uuid,v,true);
 select * into t from public.tasks where id=(r->>'id')::uuid;perform public.task_app_mutate(t.id,t.updated_at,'delete');
 select * into t from public.tasks where id=t.id;r:=public.task_app_deleted_templates()->0;
 selection:=jsonb_build_array(jsonb_build_object('kind','task','id',t.id,'version',t.updated_at),jsonb_build_object('kind','template','id',r->>'id','version',r->>'updated_at'));
 -- Deliberately coinciding task/template UUIDs remain two distinct items.
 begin perform public.task_app_bin_items('restore',jsonb_set(selection,'{1,version}','"2020-01-01T00:00:00Z"'),true);raise exception 'Expected mixed stale rejected';exception when sqlstate 'P0012' then null;end;
 assert not exists(select 1 from public.tasks where id=t.id and deleted_at is null);
 assert jsonb_array_length(public.task_app_deleted_templates())=1;
 begin perform public.task_app_bin_items('purge',jsonb_set(selection,'{0,version}','"2020-01-01T00:00:00Z"'),true);raise exception 'Expected stale task rejected';exception when sqlstate 'P0012' then null;end;
 begin perform public.task_app_bin_items('restore',selection,false);raise exception 'Expected confirmation';exception when check_violation then null;end;
 begin perform public.task_app_bin_items('restore',jsonb_build_array(selection->1,selection->1),true);raise exception 'Expected duplicate rejected';exception when check_violation then null;end;
 begin perform public.task_app_bin_items('restore',jsonb_set(selection,'{1,kind}','"wrong"'),true);raise exception 'Expected wrong kind';exception when check_violation then null;end;
 r:=public.task_app_bin_items('restore',selection,true);assert jsonb_array_length(r->'items')=2;
 assert exists(select 1 from public.tasks where id=t.id and deleted_at is null and status='completed');assert exists(select 1 from public.task_templates where id=t.id);
 select * into t from public.tasks where id=t.id;perform public.task_app_mutate(t.id,t.updated_at,'delete');
 select * into t from public.tasks where id=t.id;select updated_at into v from public.task_templates where id=t.id;perform public.task_app_remove_template(t.id,v,true);
 r:=public.task_app_deleted_templates()->0;
 selection:=jsonb_build_array(jsonb_build_object('kind','task','id',t.id,'version',t.updated_at),jsonb_build_object('kind','template','id',r->>'id','version',r->>'updated_at'));
 perform public.task_app_bin_items('purge',selection,true);
 assert not exists(select 1 from public.tasks where id=t.id);assert jsonb_array_length(public.task_app_deleted_templates())=0;
 -- Purging copied tasks/templates cannot erase independent yearly credit.
 assert (public.task_app_member_history()->'totals'->0->>'count')::int=1;
end$$;
reset role;
-- Server-only inspection of private queue rows in this disposable test.
-- A stale mixed selection also rolls back repeat-series/queue restoration.
do $$declare t public.tasks;r jsonb;before_series jsonb;before_pending jsonb;before_task jsonb;selection jsonb;begin
 r:=public.task_app_save_template('00000000-0000-4000-8000-000000001082',null,'Repeat restore fixture','[{"title":"Repeat notes","notes":"Keep all content"}]');
 perform public.task_app_remove_template((r->>'id')::uuid,(r->>'updated_at')::timestamptz,true);
 insert into public.tasks(title,due_date,due_time,repeat_rule) values('Repeat restore fixture',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'23:50','daily') returning * into t;
 perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');select * into t from public.tasks where id=t.id;
 perform public.task_app_mutate(t.id,t.updated_at,'delete');select * into t from public.tasks where id=t.id;
 before_task:=to_jsonb(t);
 select jsonb_agg(to_jsonb(s) order by s.id) into before_series from public.task_series s where owner_id=auth.uid();
 select jsonb_agg(to_jsonb(q) order by q.id) into before_pending from public.task_repeat_pending q where owner_id=auth.uid();
 r:=public.task_app_deleted_templates()->0;
 selection:=jsonb_build_array(jsonb_build_object('kind','task','id',t.id,'version',t.updated_at),jsonb_build_object('kind','template','id',r->>'id','version',r->>'updated_at'));
 begin perform public.task_app_bin_items('restore',jsonb_set(selection,'{1,version}','"2020-01-01T00:00:00Z"'),true);raise exception 'Expected rollback of resumed repeat';exception when sqlstate 'P0012' then null;end;
 assert before_task=(select to_jsonb(s) from public.tasks s where id=t.id);
 assert before_series is not distinct from (select jsonb_agg(to_jsonb(s) order by s.id) from public.task_series s where owner_id=auth.uid());
 assert before_pending is not distinct from (select jsonb_agg(to_jsonb(q) order by q.id) from public.task_repeat_pending q where owner_id=auth.uid());
 perform public.task_app_bin_items('restore',selection,true);
 assert (select repeat_rule from public.tasks where id=t.id)='daily';
 assert (select count(*) from public.task_repeat_pending where owner_id=auth.uid() and generated_at is null and not cancelled)=1;
 begin perform public.task_app_bin_items('restore',selection,true);raise exception 'Expected stale repeat restore';exception when sqlstate 'P0012' then null;end;
 assert (select count(*) from public.task_repeat_pending where owner_id=auth.uid() and generated_at is null and not cancelled)=1;
end$$;
reset role;
do $$begin
 assert not exists(select 1 from public.task_templates where id='00000000-0000-4000-8000-000000001081');
 assert not exists(select 1 from realtime.messages where payload ? 'items' or payload ? 'name' or payload ? 'notes');
end$$;
set role anon;
do $$begin begin perform public.task_app_deleted_templates();raise exception 'Expected anonymous denied';exception when insufficient_privilege then null;end;end$$;
reset role;
rollback;
select 'PASS: template removal, full restore, physical purge, selected-member/owner isolation, stale mixed rollback, typed UUID collisions, task/stat preservation';
