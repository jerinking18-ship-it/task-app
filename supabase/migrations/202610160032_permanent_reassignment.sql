-- Local review only. Additive RPC; no backfill, cleanup, schedule or data reset.
begin;
do $$begin
 if to_regprocedure('public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)') is not null then
  raise exception 'Permanent reassignment is already installed; do not replay';
 end if;
 if to_regprocedure('public.task_app_remove_restriction(uuid,timestamptz,boolean)') is null then
  raise exception 'Install the reviewed migrations through 031 first';
 end if;
end;$$;

-- Keep assignment duration independent of the existing content/calendar scope.
-- Reuse the current verified manager/assignee/status/absence mutation guards.
-- The series advisory lock is also used by completion and the repeat worker,
-- so the selected task, later active occurrences and future assignee commit
-- together. Earlier occurrences, completed records and fines are untouched.
create function public.task_app_reassign_permanently(task_id uuid,expected_version timestamptz,operation text,
 fields jsonb default null,new_status text default null,edit_scope text default 'this',expected_series_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;r jsonb;assignee uuid;locked_series uuid;version timestamptz;conflict_details jsonb;
begin
 m:=public.task_app_require_role(true);
 if operation is distinct from 'update' or new_status is not null or edit_scope is null or edit_scope not in('this','future')
 or task_id is null or expected_version is null or not isfinite(expected_version)
 or expected_series_version is null or not isfinite(expected_series_version)
 or jsonb_typeof(fields) is distinct from 'object' then
  raise exception 'Choose a valid reassignment' using errcode='23514';end if;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is null then return null;end if;
 locked_series:=t.series_id;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||t.assigned_to_member_id::text||':'||t.category_id::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null for update;
 if t.id is null then return null;end if;
 if t.series_id is distinct from locked_series then return jsonb_build_object('conflict',true);end if;
 select max(updated_at) into version from public.tasks where owner_id=m.owner_id and deleted_at is null and(series_id=t.series_id or id=t.id);
 select jsonb_build_object('conflict',true,'series_version',version,'future',coalesce(jsonb_agg(to_jsonb(f) order by f.occurrence_number),'[]'::jsonb))
 into conflict_details from public.tasks f where f.owner_id=m.owner_id and f.series_id=t.series_id
 and f.occurrence_number>t.occurrence_number and f.status='active' and f.deleted_at is null;
 if t.updated_at is distinct from expected_version or version is distinct from expected_series_version then return conflict_details;end if;
 assignee:=(fields->>'assigned_to_member_id')::uuid;
 if t.series_id is null or t.repeat_rule='off' or coalesce(fields->>'repeat_rule','off')='off'
 or assignee is null or assignee is not distinct from t.assigned_to_member_id then
  raise exception 'Permanent reassignment requires a repeating task and a new assignee' using errcode='23514';end if;
 if t.status<>'active' then raise exception 'Reopen this task before reassignment' using errcode='P0409';end if;
 if fields->>'status' is distinct from t.status then raise exception 'Reassign separately from completion' using errcode='P0403';end if;
 -- Same row order as future calendar edits; no worker can release this series
 -- between validating the version and changing its future assignee.
 perform 1 from public.tasks where owner_id=m.owner_id and series_id=t.series_id order by id for update;
 r:=public.task_app_mutate(task_id,expected_version,'update',fields,null,edit_scope,expected_series_version);
 if r is null or coalesce(r->>'conflict','false')='true' then return r;end if;
 if (r->>'series_id')::uuid is distinct from t.series_id then raise exception 'Repeat series changed' using errcode='P0409';end if;
 update public.task_series set assigned_to_member_id=assignee where owner_id=m.owner_id and id=t.series_id;
 if not found then raise exception 'Repeat series unavailable' using errcode='P0409';end if;
 update public.tasks set assigned_to_member_id=assignee where owner_id=m.owner_id and series_id=t.series_id
 and occurrence_number>t.occurrence_number and status='active' and deleted_at is null
 and assigned_to_member_id is distinct from assignee;
 -- Pending repeats carry no assignee snapshot. Their insertion trigger reads
 -- task_series.assigned_to_member_id, including detached scheduled successors.
 select to_jsonb(saved)||jsonb_build_object('series_version',(select max(updated_at) from public.tasks
 where owner_id=m.owner_id and series_id=t.series_id and deleted_at is null)) into r
 from public.tasks saved where saved.owner_id=m.owner_id and saved.id=t.id;
 return r;
end;$$;
revoke all on function public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz) to authenticated;
commit;
