-- Additive manager-only reassignment. No backfill, deletion, jobs or old grants change.
begin;
do $$begin
 if to_regprocedure('public.task_app_guard_completion_start()')is null then raise exception 'Install reviewed038 first';end if;
 if to_regprocedure('public.task_app_reassign_all(uuid,timestamptz,uuid,text,boolean,jsonb)')is not null then raise exception '039 already installed; never replay';end if;
end;$$;
create function public.task_app_reassignment_state(workspace_id uuid,source_id uuid)
returns jsonb language sql stable security definer set search_path=''as $$
 with selected as(select t.*from public.tasks t where t.owner_id=workspace_id and t.assigned_to_member_id=source_id and t.status='active'and t.deleted_at is null and t.history_at is null),
 material as(select jsonb_build_object('tasks',(select coalesce(jsonb_agg(to_jsonb(t)order by id),'[]')from selected t),
 'series',(select coalesce(jsonb_agg(to_jsonb(s)order by id),'[]')from public.task_series s where s.owner_id=workspace_id and s.id in(select series_id from selected)),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p)order by id),'[]')from public.task_special_plans p where p.owner_id=workspace_id and p.id in(select special_plan_id from selected)),
 'meetings',(select coalesce(jsonb_agg(to_jsonb(e)order by id),'[]')from public.task_special_meetings e where e.owner_id=workspace_id and e.id in(select p.meeting_id from public.task_special_plans p where p.id in(select special_plan_id from selected))))as value)
 select jsonb_build_object('sourceId',source_id,'count',(select count(*)from selected),'repeatCount',(select count(*)from selected where series_id is not null and repeat_rule<>'off'or special_plan_id is not null),'token',md5(material.value::text))from material;
$$;
create function public.task_app_reassignment_fields(t public.tasks)
returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('title',t.title,'notes',t.notes,'status',t.status,'due_date',t.due_date,'due_time',left(t.due_time::text,5),'priority',t.priority,'category_id',t.category_id,'weekdays',to_jsonb(t.weekdays),'repeat_rule',case when t.special_plan_id is null then t.repeat_rule else 'daily'end,'assigned_to_member_id',t.assigned_to_member_id,'sunday_service',t.sunday_service)
 ||case when t.special_plan_id is null then '{}'::jsonb else jsonb_build_object('special_days',(select e.duration_days from public.task_special_plans p join public.task_special_meetings e on e.id=p.meeting_id where p.id=t.special_plan_id and p.owner_id=t.owner_id))end;
$$;
create function public.task_app_reassignment_preview(task_id uuid,expected_version timestamptz)
returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;t public.tasks;s jsonb;
begin
 m:=public.task_app_require_role(true);
 select *into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null and history_at is null and status='active';
 if t.id is null or t.updated_at is distinct from expected_version then raise exception 'Task changed; reopen the reassignment popup'using errcode='P0039';end if;
 s:=public.task_app_reassignment_state(m.owner_id,t.assigned_to_member_id);
 if(s->>'count')::integer not between 1 and 10000 then raise exception 'Task selection unavailable'using errcode='23514';end if;
 return s;
end;$$;
create function public.task_app_reassign_all(task_id uuid,expected_version timestamptz,new_assignee uuid,expected_snapshot text,assignment_future boolean,selected_fields jsonb)
returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;item public.tasks;selected public.tasks;r jsonb;s jsonb;ids uuid[];series_ids uuid[];plan_ids uuid[];lock_key bigint;version timestamptz;f jsonb;source_id uuid;
begin
 m:=public.task_app_require_role(true);
 if expected_version is null or not isfinite(expected_version)or expected_snapshot is null or expected_snapshot!~'^[0-9a-f]{32}$'or assignment_future is null or jsonb_typeof(selected_fields)is distinct from 'object'or selected_fields->>'status'is distinct from 'active'or (selected_fields->>'assigned_to_member_id')::uuid is distinct from new_assignee then raise exception 'Confirm a valid reassignment'using errcode='23514';end if;
 -- Same order as Special mutations, then regular series/attendance locks.
 perform pg_advisory_xact_lock(hashtextextended('special:'||m.owner_id::text,0));
 select *into selected from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null and history_at is null and status='active';
 if selected.id is null or selected.updated_at is distinct from expected_version then raise exception 'Task changed; review selection again'using errcode='P0039';end if;
 source_id:=selected.assigned_to_member_id;
 if new_assignee is null or new_assignee=source_id then raise exception 'Choose a different assignee'using errcode='23514';end if;
 perform 1 from public.account_members where id=new_assignee and owner_id=m.owner_id and left_at is null and auth_user_id is not null for share;
 if not found then raise exception 'Choose a current workspace member'using errcode='23514';end if;
 for lock_key in select distinct hashtextextended(coalesce(t.series_id,t.id)::text,0)from public.tasks t where t.owner_id=m.owner_id and t.assigned_to_member_id=source_id and t.status='active'and t.deleted_at is null and t.history_at is null order by 1 loop perform pg_advisory_xact_lock(lock_key);end loop;
 for lock_key in select distinct hashtextextended('attendance:'||source_id::text||':'||t.category_id::text,0)from public.tasks t where t.owner_id=m.owner_id and t.assigned_to_member_id=source_id and t.status='active'and t.deleted_at is null and t.history_at is null and t.category_id is not null order by 1 loop perform pg_advisory_xact_lock(lock_key);end loop;
 perform 1 from public.tasks t where t.owner_id=m.owner_id and t.assigned_to_member_id=source_id and t.status='active'and t.deleted_at is null and t.history_at is null order by id for update;
 s:=public.task_app_reassignment_state(m.owner_id,source_id);
 if s->>'token'is distinct from expected_snapshot or(s->>'count')::integer not between 1 and 10000 then raise exception 'Task selection changed; review the count again'using errcode='P0039';end if;
 select *into selected from public.tasks where id=task_id and owner_id=m.owner_id;
 if selected.updated_at is distinct from expected_version or selected.assigned_to_member_id is distinct from source_id then raise exception 'Task changed; review again'using errcode='P0039';end if;
 -- Bulk is assignment-only for other rows. Save schedule edits separately so a
 -- shared meeting move or repeat cancellation cannot silently expand its scope.
 if(selected_fields-'assigned_to_member_id'-'title'-'notes'-'priority')is distinct from(public.task_app_reassignment_fields(selected)-'assigned_to_member_id'-'title'-'notes'-'priority')then raise exception 'Save schedule changes separately before bulk reassignment'using errcode='23514';end if;
 select array_agg(id order by id),array_agg(distinct series_id)filter(where series_id is not null),array_agg(distinct special_plan_id)filter(where special_plan_id is not null)into ids,series_ids,plan_ids from public.tasks where owner_id=m.owner_id and assigned_to_member_id=source_id and status='active'and deleted_at is null and history_at is null;
 for item in select *from public.tasks where id=any(ids)order by id loop
  f:=case when item.id=task_id then selected_fields else public.task_app_reassignment_fields(item)||jsonb_build_object('assigned_to_member_id',new_assignee)end;
  select case when item.special_plan_id is not null then(select p.updated_at from public.task_special_plans p where p.id=item.special_plan_id)else(select max(x.updated_at)from public.tasks x where x.owner_id=m.owner_id and x.deleted_at is null and(x.series_id=item.series_id or x.id=item.id))end into version;
  r:=public.task_app_mutate(item.id,item.updated_at,'update',f,null,'this',version);
  if r is null or coalesce((r->>'conflict')::boolean,false)or(r->>'assigned_to_member_id')::uuid is distinct from new_assignee then raise exception 'Task changed; no tasks reassigned'using errcode='P0039';end if;
 end loop;
 if assignment_future then
  update public.task_series set assigned_to_member_id=new_assignee where owner_id=m.owner_id and id=any(series_ids);
  update public.task_special_plans set payload=jsonb_set(payload,'{assigned_to_member_id}',to_jsonb(new_assignee)),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')where owner_id=m.owner_id and id=any(plan_ids);
 end if;
 select to_jsonb(t)into r from public.tasks t where id=task_id and owner_id=m.owner_id;
 return jsonb_build_object('task',r,'count',cardinality(ids));
end;$$;
revoke all on function public.task_app_reassignment_state(uuid,uuid),public.task_app_reassignment_fields(public.tasks),public.task_app_reassignment_preview(uuid,timestamptz),public.task_app_reassign_all(uuid,timestamptz,uuid,text,boolean,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.task_app_reassignment_preview(uuid,timestamptz),public.task_app_reassign_all(uuid,timestamptz,uuid,text,boolean,jsonb)to authenticated;
notify pgrst,'reload schema';
commit;
