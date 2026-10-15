-- LOCAL ONLY. Sunday Service metadata; no deadline, absence, fine or role changes.
-- Apply NEW026 once after025. Never replay installed migrations.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.tasks,public.task_repeat_pending in access exclusive mode;
create temporary table sunday_original_tasks on commit drop as select id,to_jsonb(t)as original from public.tasks t;
create temporary table sunday_original_pending on commit drop as select id,to_jsonb(p)as original from public.task_repeat_pending p;
create temporary table sunday_trigger_states on commit drop as select tgname,tgenabled from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal;
create temporary table sunday_function_grants on commit drop as select oid,proowner,proacl from pg_proc where oid in(
 'public.task_app_create_tasks(jsonb)'::regprocedure,
 'public.task_app_mutate_task(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure,
 'public.task_app_mutate_before_bin(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure,
 'public.task_app_spawn_next()'::regprocedure,
 'public.task_app_release_repeats(uuid,timestamptz)'::regprocedure);
alter table public.tasks add column sunday_service text check(sunday_service in('morning','evening'));
-- Version stamps, completion credits, fine assessments and notifications must
-- not run for metadata backfill. The exclusive lock blocks all concurrent writes;
-- each original trigger mode is restored in the same transaction, before commit.
do $backfill$declare trigger_row record;begin
 for trigger_row in select * from sunday_trigger_states loop execute format('alter table public.tasks disable trigger %I',trigger_row.tgname);end loop;
 update public.tasks t set sunday_service='evening'from public.categories c where c.owner_id=t.owner_id and c.id=t.category_id and c.name='Sunday Service';
 for trigger_row in select * from sunday_trigger_states loop execute format('alter table public.tasks %s trigger %I',case trigger_row.tgenabled when 'D'then'disable'when 'A'then'enable always'when 'R'then'enable replica'else'enable'end,trigger_row.tgname);end loop;
end;$backfill$;
update public.task_repeat_pending p set payload=p.payload||jsonb_build_object('sunday_service','evening')from public.categories c where p.owner_id=c.owner_id and p.payload->>'category_id'=c.id::text and c.name='Sunday Service';
create function public.task_app_validate_sunday_service()returns trigger language plpgsql security definer set search_path='' as $$
declare category_name text;
begin
 select name into category_name from public.categories where owner_id=new.owner_id and id=new.category_id;
 if category_name='Sunday Service'then new.sunday_service:=coalesce(new.sunday_service,'evening');
 elsif tg_op='UPDATE'and new.category_id is distinct from old.category_id then new.sunday_service:=null;
 elsif new.sunday_service is not null then raise exception 'Subcategory is only available for Sunday Service'using errcode='23514';end if;
 return new;
end;$$;
revoke all on function public.task_app_validate_sunday_service()from public,anon,authenticated,service_role;
create trigger tasks_sunday_service before insert or update on public.tasks for each row execute function public.task_app_validate_sunday_service();
create function pg_temp.sunday_patch(signature text,needle text,replacement text,expected integer)returns void language plpgsql as $$
declare body text;matches integer;
begin
 body:=pg_get_functiondef(signature::regprocedure);matches:=(length(body)-length(replace(body,needle,'')))/length(needle);
 if matches<>expected then raise exception 'Unexpected Sunday patch shape for %: expected %, got %',signature,expected,matches;end if;
 execute replace(body,needle,replacement);
end;$$;
select pg_temp.sunday_patch('public.task_app_create_tasks(jsonb)','''repeat_rule'',''assigned_to_member_id''))','''repeat_rule'',''assigned_to_member_id'',''sunday_service''))',1);
select pg_temp.sunday_patch('public.task_app_create_tasks(jsonb)','weekdays,repeat_rule,assigned_to_member_id)','weekdays,repeat_rule,assigned_to_member_id,sunday_service)',1);
select pg_temp.sunday_patch('public.task_app_create_tasks(jsonb)','(f->>''assigned_to_member_id'')::uuid) returning * into t;','(f->>''assigned_to_member_id'')::uuid,f->>''sunday_service'') returning * into t;',1);
select pg_temp.sunday_patch('public.task_app_mutate_task(uuid,timestamptz,text,jsonb,text,text,timestamptz)','''weekdays'',''repeat_rule''))','''weekdays'',''repeat_rule'',''sunday_service''))',1);
select pg_temp.sunday_patch('public.task_app_mutate_task(uuid,timestamptz,text,jsonb,text,text,timestamptz)','category_id=(fields->>''category_id'')::uuid,','category_id=(fields->>''category_id'')::uuid,sunday_service=case when exists(select 1 from public.categories c where c.owner_id=own_id and c.id=(fields->>''category_id'')::uuid and c.name=''Sunday Service'') then case when fields ? ''sunday_service'' then fields->>''sunday_service'' else target.sunday_service end else null end,',2);
select pg_temp.sunday_patch('public.task_app_mutate_before_bin(uuid,timestamptz,text,jsonb,text,text,timestamptz)','''category_id'',fields->>''category_id'',','''category_id'',fields->>''category_id'',''sunday_service'',case when exists(select 1 from public.categories c where c.owner_id=own_id and c.id=(fields->>''category_id'')::uuid and c.name=''Sunday Service'') then case when fields ? ''sunday_service'' then fields->>''sunday_service'' else target.sunday_service end else null end,',1);
select pg_temp.sunday_patch('public.task_app_spawn_next()','''category_id'',new.category_id,','''category_id'',new.category_id,''sunday_service'',new.sunday_service,',1);
select pg_temp.sunday_patch('public.task_app_release_repeats(uuid,timestamptz)','category_id,weekdays,repeat_rule,','category_id,sunday_service,weekdays,repeat_rule,',1);
select pg_temp.sunday_patch('public.task_app_release_repeats(uuid,timestamptz)','(pending.payload->>''category_id'')::uuid,','(pending.payload->>''category_id'')::uuid,pending.payload->>''sunday_service'',',1);
do $preserved$begin
 if exists(select 1 from public.tasks t full join sunday_original_tasks b using(id)where t.id is null or b.id is null or to_jsonb(t)-'sunday_service' is distinct from b.original)then raise exception 'Original task data changed; rollback';end if;
 if exists(select 1 from public.task_repeat_pending p full join sunday_original_pending b using(id)where p.id is null or b.id is null or (to_jsonb(p)-'payload')is distinct from(b.original-'payload')or(p.payload-'sunday_service')is distinct from(b.original->'payload'))then raise exception 'Original queue data changed; rollback';end if;
 if exists(select 1 from sunday_trigger_states b left join pg_trigger t on t.tgrelid='public.tasks'::regclass and t.tgname=b.tgname where t.oid is null or t.tgenabled is distinct from b.tgenabled)then raise exception 'Original trigger mode changed; rollback';end if;
 if exists(select 1 from sunday_function_grants b left join pg_proc p on p.oid=b.oid where p.oid is null or p.proowner is distinct from b.proowner or p.proacl is distinct from b.proacl)then raise exception 'Original grants changed; rollback';end if;
end;$preserved$;
notify pgrst,'reload schema';
commit;
