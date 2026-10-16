-- LOCAL REVIEW ONLY. Additive read-only audit log, from installation forward.
-- No backfill, existing function replacement, retention job or hosted activation.
begin;
set local lock_timeout='5s';
create table public.task_activity_log(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.task_workspaces(owner_id) on delete cascade,
 actor_id uuid,actor_name text,actor_role text,
 affected_ids uuid[] not null default '{}',
 kind text not null,
 entity_id uuid,title text,category_name text,
 details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default clock_timestamp()
);
create index activity_owner_time on public.task_activity_log(owner_id,created_at desc,id desc);
create index activity_actor_time on public.task_activity_log(owner_id,actor_id,created_at desc,id desc);
create index activity_affected on public.task_activity_log using gin(affected_ids);
alter table public.task_activity_log enable row level security;
revoke all on public.task_activity_log from public,anon,authenticated,service_role;

create function public.task_app_record_activity(own uuid,event_kind text,entity uuid,event_title text,category text,affected uuid[],event_details jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare m public.account_members;
begin
 -- Maintenance has no verified actor: recorded as System. Never copy JWTs,
 -- credentials, invitation email/token, task notes, or whole source records.
 if not exists(select 1 from public.task_workspaces where owner_id=own)then return;end if;
 m:=public.task_app_current_member();
 if m.owner_id is distinct from own or(event_kind='task_created'and event_details->>'automatic'='true')then m:=null;end if;
 insert into public.task_activity_log(owner_id,actor_id,actor_name,actor_role,affected_ids,kind,entity_id,title,category_name,details)
 values(own,m.id,m.name,m.role,coalesce(array(select distinct x from unnest(affected)x where x is not null),'{}'),event_kind,entity,event_title,category,event_details);
end;$$;

create function public.task_app_activity_event()returns trigger language plpgsql security definer set search_path='' as $$
declare n jsonb:=case when tg_op='DELETE'then to_jsonb(old)else to_jsonb(new)end;
 o jsonb:=case when tg_op='UPDATE'then to_jsonb(old)else '{}'::jsonb end;
 own uuid:=(n->>'owner_id')::uuid;entity uuid:=coalesce(n->>'id',n->>'task_id',n->>'owner_id')::uuid;
 category text;title text;target uuid;previous uuid;kind text;details jsonb:='{}';m public.account_members;t public.tasks;related uuid[]:='{}';
begin
 if tg_table_name='tasks'then
  title:=n->>'title';target:=(n->>'assigned_to_member_id')::uuid;previous:=(o->>'assigned_to_member_id')::uuid;
  select name into category from public.categories where id=(n->>'category_id')::uuid and owner_id=own;
  if tg_op='DELETE'then kind:='task_deleted';
  elsif tg_op='INSERT'then kind:='task_created';
  elsif (o->>'deleted_at')is null and(n->>'deleted_at')is not null then kind:='task_moved';
  elsif (o->>'deleted_at')is not null and(n->>'deleted_at')is null then kind:='task_restored';
  elsif n->>'status'is distinct from o->>'status'then
   kind:=case when n->>'status'='active'then 'task_reopened'when n->>'missed_completion_role'is not null then 'task_missed'else 'task_completed'end;
  elsif target is distinct from previous then
   -- Taking a released task inserts its claim first; avoid a second reassign event.
   if exists(select 1 from public.task_coverage_claims where task_id=entity and owner_id=own and original_member_id=previous and taken_by_member_id=target and taken_at=statement_timestamp())then return null;end if;
   kind:='task_reassigned';
  elsif jsonb_build_array(n->'title',n->'notes',n->'due_date',n->'due_time',n->'priority',n->'category_id',n->'weekdays',n->'repeat_rule',n->'sunday_service')is distinct from jsonb_build_array(o->'title',o->'notes',o->'due_date',o->'due_time',o->'priority',o->'category_id',o->'weekdays',o->'repeat_rule',o->'sunday_service')then kind:='task_edited';
  else return null;end if;
  related:=array(select original_member_id from public.task_coverage_claims where task_id=entity and owner_id=own)||array[(n->>'completed_by_member_id')::uuid,(o->>'completed_by_member_id')::uuid];
  details:=jsonb_strip_nulls(jsonb_build_object('service',n->>'sunday_service','previousMemberId',previous,'memberId',target,'automatic',tg_op='INSERT'and coalesce((n->>'occurrence_number')::integer,0)>0));
 elsif tg_table_name='task_series'then
  if tg_op<>'UPDATE'or n->>'assigned_to_member_id'is not distinct from o->>'assigned_to_member_id'then return null;end if;
  kind:='repeat_reassigned';target:=(n->>'assigned_to_member_id')::uuid;previous:=(o->>'assigned_to_member_id')::uuid;
  title:='Future repeating tasks';
 elsif tg_table_name='task_coverage_claims'then
  if tg_op<>'INSERT'then return null;end if;
  select * into t from public.tasks where id=(n->>'task_id')::uuid and owner_id=own;
  kind:='task_taken';title:=t.title;target:=(n->>'original_member_id')::uuid;
  select name into category from public.categories where id=t.category_id and owner_id=own;
 elsif tg_table_name='account_members'then
  target:=(n->>'id')::uuid;
  if tg_op='INSERT'then kind:='member_joined';
  elsif tg_op='DELETE'then kind:='member_left';
  elsif n->>'left_at'is distinct from o->>'left_at'and n->>'left_at'is not null then kind:='member_left';
  elsif n->>'role'is distinct from o->>'role'then kind:='role_changed';details:=jsonb_build_object('from',o->>'role','to',n->>'role');
  elsif n->>'name'is distinct from o->>'name'then kind:='name_changed';details:=jsonb_build_object('from',o->>'name','to',n->>'name');
  else return null;end if;
  details:=details||jsonb_build_object('memberName',n->>'name');
 elsif tg_table_name='account_member_absences'then
  if tg_op='DELETE'then return null;end if; -- deletion/expiry is not an unmark.
  target:=(n->>'member_id')::uuid;
  select name into category from public.categories where id=(n->>'category_id')::uuid and owner_id=own;
  if tg_op='INSERT'then kind:='absence_marked';
  elsif n->>'cancelled_at'is distinct from o->>'cancelled_at'and n->>'cancelled_at'is not null then
   kind:=case when o->>'restriction_role'is not null then 'restriction_removed'else 'absence_unmarked'end;
  elsif n->>'morning_returned_at'is distinct from o->>'morning_returned_at'and n->>'morning_returned_at'is not null then kind:='absence_unmarked';details:=jsonb_build_object('service','morning');
  elsif n->>'evening_returned_at'is distinct from o->>'evening_returned_at'and n->>'evening_returned_at'is not null then kind:='absence_unmarked';details:=jsonb_build_object('service','evening');
  else return null;end if;
  details:=jsonb_strip_nulls(jsonb_build_object('service',n->>'sunday_service','automatic',n->>'restriction_role'is not null))||details;
 elsif tg_table_name='task_fines'then
  title:=n->>'title';category:=n->>'category_name';target:=(n->>'member_id')::uuid;
  if tg_op='INSERT'then kind:='fine_issued';
  elsif tg_op='UPDATE'and n->>'status'is distinct from o->>'status'then kind:=case when n->>'status'='paid'then 'fine_paid'when n->>'status'='cancelled'then 'fine_cancelled'end;
  else return null;end if;
  if kind is null then return null;end if;
  details:=jsonb_build_object('amountPaise',(n->>'amount_paise')::integer,'memberName',n->>'member_name');
 elsif tg_table_name='task_templates'then
  title:=n->>'name';
  if tg_op='DELETE'then kind:='template_deleted';
  elsif tg_op='INSERT'then kind:='template_created';
  elsif o->>'deleted_at'is null and n->>'deleted_at'is not null then kind:='template_moved';
  elsif o->>'deleted_at'is not null and n->>'deleted_at'is null then kind:='template_restored';
  elsif n->>'name'is distinct from o->>'name'or n->'items'is distinct from o->'items'then kind:='template_edited';
  else return null;end if;
 elsif tg_table_name='task_reopen_requests'then
  title:=n->>'task_title';target:=(n->>'requester_id')::uuid;previous:=(n->>'reviewer_id')::uuid;
  if tg_op='INSERT'then kind:='reopen_requested';
  elsif tg_op='UPDATE'and n->>'status'is distinct from o->>'status'then kind:='reopen_'||(n->>'status');
  else return null;end if;
 elsif tg_table_name='task_meeting_settings'then
  if tg_op='UPDATE'and n->>'title'is not distinct from o->>'title'then return null;end if;
  kind:='meeting_title_changed';category:='Special Meeting';title:=coalesce(n->>'title','Special Meeting');
 else return null;end if;
 -- Resolve affected names now too, so removals do not erase historic attribution.
 details:=details||jsonb_strip_nulls(jsonb_build_object('memberId',target,'memberName',coalesce((select name from public.account_members where id=target and owner_id=own),details->>'memberName'),
  'previousMemberId',previous,'previousMemberName',(select name from public.account_members where id=previous and owner_id=own)));
 perform public.task_app_record_activity(own,kind,entity,title,category,array[target,previous]||related,details);
 return null;
end;$$;

do $$declare table_name text;begin
 foreach table_name in array array['tasks','task_series','task_coverage_claims','account_members','account_member_absences','task_fines','task_templates','task_reopen_requests','task_meeting_settings']loop
 execute format('create trigger zz_activity_log after insert or update or delete on public.%I for each row execute function public.task_app_activity_event()',table_name);
 end loop;
end;$$;

create function public.task_app_activity(p_member uuid default null,p_relation text default 'performed',p_meeting text default null,p_kind text default null,p_since timestamptz default null,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;result jsonb;
begin
 m:=public.task_app_require_role(true);
 if p_relation is null or p_relation not in('performed','affecting')or(p_before is null)<>(p_before_id is null)then raise exception 'Invalid activity filter'using errcode='23514';end if;
 if p_member is not null and not exists(select 1 from public.account_members where owner_id=m.owner_id and id=p_member)then raise exception 'Member unavailable'using errcode='P0403';end if;
 with filtered as materialized(
  select a.* from public.task_activity_log a where a.owner_id=m.owner_id
  and(p_member is null or(p_relation='performed'and a.actor_id=p_member)or(p_relation='affecting'and p_member=any(a.affected_ids)and a.actor_id is distinct from p_member))
  and(p_meeting is null or a.category_name=p_meeting)and(p_kind is null or a.kind=p_kind)
  and(p_since is null or a.created_at>=p_since)
 ),page as(select * from filtered where p_before is null or(created_at,id)<(p_before,p_before_id)order by created_at desc,id desc limit 101)
 select jsonb_build_object('serverNow',clock_timestamp(),'total',(select count(*)from filtered),'hasMore',(select count(*)>100 from page),
  'entries',coalesce((select jsonb_agg(item order by created_at desc,id desc)from(
   select a.created_at,a.id,jsonb_build_object('id',a.id,'kind',a.kind,'actorId',a.actor_id,'actorName',coalesce(actor.name,a.actor_name,'System'),'actorRole',a.actor_role,
    'affectedIds',a.affected_ids,'title',a.title,'category',a.category_name,'createdAt',a.created_at,'details',a.details||jsonb_strip_nulls(jsonb_build_object(
     'memberName',coalesce(target.name,a.details->>'memberName'),'previousMemberName',coalesce(previous.name,a.details->>'previousMemberName'))))item
   from page a left join public.account_members actor on actor.id=a.actor_id and actor.owner_id=a.owner_id
   left join public.account_members target on target.id=(a.details->>'memberId')::uuid and target.owner_id=a.owner_id
   left join public.account_members previous on previous.id=(a.details->>'previousMemberId')::uuid and previous.owner_id=a.owner_id
   order by a.created_at desc,a.id desc limit 100)items),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'left',left_at is not null)order by name,id)from public.account_members where owner_id=m.owner_id),'[]'::jsonb))into result;
 return result;
end;$$;
revoke all on function public.task_app_record_activity(uuid,text,uuid,text,text,uuid[],jsonb),public.task_app_activity_event(),public.task_app_activity(uuid,text,text,text,timestamptz,timestamptz,uuid)from public,anon,authenticated,service_role;
grant execute on function public.task_app_activity(uuid,text,text,text,timestamptz,timestamptz,uuid)to authenticated;
notify pgrst,'reload schema';
commit;
