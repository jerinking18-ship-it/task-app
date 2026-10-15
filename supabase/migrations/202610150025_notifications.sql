-- LOCAL ONLY. Personal in-app messages; no email, push, new jobs or backfill.
begin;
create table public.task_notification_configuration(singleton boolean primary key default true check(singleton),started_at timestamptz not null);
insert into public.task_notification_configuration values(true,clock_timestamp());
create table public.task_notification_preferences(
 owner_id uuid not null,member_id uuid primary key,
 availability boolean not null default true,coverage_updates boolean not null default true,reassignments boolean not null default true,
 cleared_through timestamptz,
 foreign key(owner_id,member_id)references public.account_members(owner_id,id)on delete cascade
);
insert into public.task_notification_preferences(owner_id,member_id)select owner_id,id from public.account_members;
create table public.task_notifications(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,recipient_id uuid not null,
 event_key text not null,kind text not null check(kind in('task_available','task_taken','released_completed','reassigned_to','reassigned_from','missed','overdue','fine_applied','fine_paid','fine_cancelled','role_changed','request_received','request_result')),
 task_id uuid,task_title text,category_name text,actor_id uuid,actor_name text,
 payload jsonb not null default '{}'check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default clock_timestamp(),read_at timestamptz,
 foreign key(owner_id,recipient_id)references public.account_members(owner_id,id)on delete cascade,
 unique(owner_id,recipient_id,event_key)
);
create index notifications_recipient_time on public.task_notifications(recipient_id,created_at desc,id);
create table public.task_reopen_requests(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,task_id uuid not null,task_title text not null,
 requester_id uuid not null,reviewer_id uuid not null,completed_at timestamptz not null,
 reason text not null check(reason in('Marked completed by mistake','Work needs correction','Work is not finished')),
 status text not null default 'pending'check(status in('pending','approved','declined','unavailable')),
 unavailable_reason text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(owner_id,requester_id)references public.account_members(owner_id,id),
 foreign key(owner_id,reviewer_id)references public.account_members(owner_id,id),
 constraint reopen_occurrence_request_key unique(owner_id,task_id,completed_at,requester_id),check(requester_id<>reviewer_id)
);
create index reopen_requests_recipient on public.task_reopen_requests(owner_id,reviewer_id,status);
alter table public.task_notification_configuration enable row level security;
alter table public.task_notification_preferences enable row level security;
alter table public.task_notifications enable row level security;
alter table public.task_reopen_requests enable row level security;
revoke all on public.task_notification_configuration,public.task_notification_preferences,public.task_notifications,public.task_reopen_requests from public,anon,authenticated,service_role;

create function public.task_app_init_notification_preferences()returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.task_notification_preferences(owner_id,member_id)values(new.owner_id,new.id)on conflict do nothing;return null;end;$$;
create trigger members_notification_preferences after insert on public.account_members for each row execute function public.task_app_init_notification_preferences();

-- Shared locks serialize permanent clearing with message creation, but do not
-- serialize independent messages against each other. Only catch-up events use
-- the clearing watermark. New committed activity always produces a new notice.
create function public.task_app_emit_notification(own uuid,recipient uuid,event text,event_kind text,task uuid default null,title text default null,category text default null,actor uuid default null,details jsonb default '{}',event_at timestamptz default null,catchup boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare pref public.task_notification_preferences;actor_label text;at_time timestamptz:=coalesce(event_at,clock_timestamp());
begin
 if recipient is null or not exists(select 1 from public.account_members where owner_id=own and id=recipient and left_at is null and auth_user_id is not null)then return;end if;
 select * into pref from public.task_notification_preferences where owner_id=own and member_id=recipient for share;
 if pref.member_id is null then raise exception 'Notification preferences unavailable';end if;
 if catchup and pref.cleared_through is not null and at_time<=pref.cleared_through then return;end if;
 select name into actor_label from public.account_members where id=actor and owner_id=own;
 insert into public.task_notifications(owner_id,recipient_id,event_key,kind,task_id,task_title,category_name,actor_id,actor_name,payload,created_at)
 values(own,recipient,event,event_kind,task,title,category,actor,actor_label,details,at_time)on conflict(owner_id,recipient_id,event_key)do nothing;
end;$$;

create function public.task_app_notify_request_result(r public.task_reopen_requests)returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.task_app_emit_notification(r.owner_id,r.requester_id,'request-result:'||r.id||':'||r.status,'request_result',r.task_id,r.task_title,null,r.reviewer_id,jsonb_build_object('requestId',r.id,'status',r.status,'unavailableReason',r.unavailable_reason),r.updated_at);
end;$$;
create function public.task_app_refresh_reopen_requests(own uuid)returns void language plpgsql security definer set search_path='' as $$
declare r public.task_reopen_requests;
begin
 for r in update public.task_reopen_requests q set status='unavailable',updated_at=clock_timestamp(),unavailable_reason=
  case when not exists(select 1 from public.tasks where id=q.task_id and owner_id=own)then 'This task was permanently deleted.'
   when exists(select 1 from public.tasks where id=q.task_id and owner_id=own and deleted_at is not null)then 'This task was moved to Bin.'
   else 'This task or its recorded completion changed.'end
 where q.owner_id=own and q.status='pending'and(not exists(select 1 from public.tasks t where t.owner_id=own and t.id=q.task_id and t.deleted_at is null
  and t.status='completed'and t.missed_completion_role is not null and t.completed_at=q.completed_at and t.completed_by_member_id=q.reviewer_id and t.assigned_to_member_id=q.requester_id)
  or not exists(select 1 from public.account_members m where m.id=q.reviewer_id and m.owner_id=own and m.left_at is null and m.auth_user_id is not null)
  or not exists(select 1 from public.account_members m where m.id=q.requester_id and m.owner_id=own and m.left_at is null and m.auth_user_id is not null))returning q.*
 loop perform public.task_app_notify_request_result(r);end loop;
end;$$;

-- Persist released-task notices at the actual event, including for offline
-- teammates, so a later first read can correctly show Taken or Unavailable.
create function public.task_app_emit_availability(t public.tasks,at_time timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare a public.account_member_absences;m public.account_members;helper public.tasks;category text;started timestamptz;
begin
 if t.deleted_at is not null or t.status<>'active'or t.assigned_to_member_id is null or(t.available_at is not null and t.available_at>at_time)then return;end if;
 select started_at into started from public.task_notification_configuration where singleton;
 select name into category from public.categories where id=t.category_id and owner_id=t.owner_id;
 for a in select * from public.account_member_absences where owner_id=t.owner_id and member_id=t.assigned_to_member_id and category_id=t.category_id and created_at>=started and cancelled_at is null and expires_at>at_time loop
  if not public.task_app_absence_covers(t,a,at_time)or exists(select 1 from public.task_coverage_claims where task_id=t.id and absence_id=a.id)then continue;end if;
  for m in select * from public.account_members where owner_id=t.owner_id and id<>t.assigned_to_member_id and left_at is null and auth_user_id is not null order by id loop
   helper:=t;helper.assigned_to_member_id:=m.id;
   if exists(select 1 from public.account_member_absences oa where oa.owner_id=t.owner_id and public.task_app_absence_covers(helper,oa,at_time))then continue;end if;
   perform public.task_app_emit_notification(t.owner_id,m.id,'available:'||t.id||':'||a.id,'task_available',t.id,t.title,category,a.member_id,jsonb_build_object('absenceId',a.id),greatest(t.created_at,t.updated_at,a.created_at,coalesce(t.available_at,a.created_at)),true);
  end loop;
 end loop;
end;$$;
create function public.task_app_absence_notification_event()returns trigger language plpgsql security definer set search_path='' as $$
declare t public.tasks;at_time timestamptz:=clock_timestamp();
begin
 if new.cancelled_at is not null or new.expires_at<=at_time then return null;end if;
 for t in select * from public.tasks where owner_id=new.owner_id and assigned_to_member_id=new.member_id and category_id=new.category_id and status='active'and deleted_at is null order by id loop
  perform public.task_app_emit_availability(t,at_time);
 end loop;
 return null;
end;$$;
create trigger absences_notification_event after insert on public.account_member_absences for each row execute function public.task_app_absence_notification_event();

create function public.task_app_task_notification_events()returns trigger language plpgsql security definer set search_path='' as $$
declare c public.task_coverage_claims;category text;covered boolean;
begin
 if tg_op='DELETE'then perform public.task_app_refresh_reopen_requests(old.owner_id);return null;end if;
 if tg_op='INSERT'then perform public.task_app_emit_availability(new,clock_timestamp());return null;end if; -- No Task assigned or repeat-ready notices.
 select name into category from public.categories where id=new.category_id and owner_id=new.owner_id;
 if new.deleted_at is null and new.assigned_to_member_id is distinct from old.assigned_to_member_id then
  covered:=exists(select 1 from public.task_coverage_claims where task_id=new.id and original_member_id=old.assigned_to_member_id and taken_by_member_id=new.assigned_to_member_id and taken_at>=old.updated_at);
  if not covered then
   perform public.task_app_emit_notification(new.owner_id,new.assigned_to_member_id,'reassigned-to:'||new.id||':'||new.updated_at,'reassigned_to',new.id,new.title,category,old.assigned_to_member_id);
   perform public.task_app_emit_notification(new.owner_id,old.assigned_to_member_id,'reassigned-from:'||new.id||':'||new.updated_at,'reassigned_from',new.id,new.title,category,new.assigned_to_member_id);
  end if;
 end if;
 if new.deleted_at is null and new.status='completed'and old.status='active'then
  if new.missed_completion_role is not null then
   perform public.task_app_emit_notification(new.owner_id,new.assigned_to_member_id,'missed:'||new.id||':'||new.completed_at,'missed',new.id,new.title,category,new.completed_by_member_id,jsonb_build_object('completedAt',new.completed_at,'role',new.missed_completion_role));
  end if;
  select * into c from public.task_coverage_claims where task_id=new.id and taken_by_member_id=new.assigned_to_member_id order by taken_at desc limit 1;
  if c.task_id is not null and c.original_member_id is distinct from new.completed_by_member_id then
   perform public.task_app_emit_notification(new.owner_id,c.original_member_id,'released-completed:'||new.id||':'||new.completed_at,'released_completed',new.id,new.title,category,new.completed_by_member_id,case when new.missed_completion_role is null then '{}'::jsonb else jsonb_build_object('role',new.missed_completion_role)end);
  end if;
 end if;
 perform public.task_app_emit_availability(new,clock_timestamp());
 perform public.task_app_refresh_reopen_requests(new.owner_id);
 return null;
end;$$;
create trigger tasks_notification_events after insert or update or delete on public.tasks for each row execute function public.task_app_task_notification_events();

create function public.task_app_claim_notification_event()returns trigger language plpgsql security definer set search_path='' as $$
declare t public.tasks;category text;
begin
 select * into t from public.tasks where id=new.task_id and owner_id=new.owner_id;
 select name into category from public.categories where id=t.category_id and owner_id=t.owner_id;
 perform public.task_app_emit_notification(new.owner_id,new.original_member_id,'taken:'||new.task_id||':'||new.absence_id,'task_taken',t.id,t.title,category,new.taken_by_member_id,jsonb_build_object('absenceId',new.absence_id),new.taken_at);
 return null;
end;$$;
create trigger claims_notification_event after insert on public.task_coverage_claims for each row execute function public.task_app_claim_notification_event();

create function public.task_app_fine_notification_event()returns trigger language plpgsql security definer set search_path='' as $$
declare k text;
begin
 if tg_op='INSERT'then k:='fine_applied';elsif old.status is distinct from new.status and new.status in('paid','cancelled')then k:='fine_'||new.status;else return null;end if;
 perform public.task_app_emit_notification(new.owner_id,new.member_id,k||':'||new.id,k,new.task_id,new.title,new.category_name,null,jsonb_build_object('fineId',new.id,'amountPaise',new.amount_paise,'status',new.status),case when tg_op='INSERT'then new.assessed_at else new.settled_at end);
 return null;
end;$$;
create trigger fines_notification_event after insert or update on public.task_fines for each row execute function public.task_app_fine_notification_event();
create function public.task_app_role_notification_event()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.role is distinct from new.role and new.left_at is null then
 perform public.task_app_emit_notification(new.owner_id,new.id,'role:'||new.id||':'||clock_timestamp(),'role_changed',null,null,null,null,jsonb_build_object('previousRole',old.role,'role',new.role));end if;return null;
end;$$;
create trigger members_role_notification_event after update of role on public.account_members for each row execute function public.task_app_role_notification_event();

-- Bounded catch-up while an app is open: no Cron installer or external delivery.
-- Stable occurrence/absence/due keys and a clear watermark prevent resurrection.
create function public.task_app_catchup_notifications()returns void language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;helper public.tasks;a public.account_member_absences;
 category text;due_at timestamptz;at_time timestamptz:=clock_timestamp();started timestamptz;
begin
 m:=public.task_app_require_role();select started_at into started from public.task_notification_configuration where singleton;
 for t in select * from public.tasks where owner_id=m.owner_id and deleted_at is null and status='active'and(available_at is null or available_at<=at_time)order by id loop
  select name into category from public.categories where id=t.category_id and owner_id=m.owner_id;
  if t.assigned_to_member_id=m.id and t.due_date is not null then
   due_at:=case when t.due_time is null then(t.due_date+1)::timestamp at time zone 'Asia/Kolkata'else(t.due_date+t.due_time)at time zone 'Asia/Kolkata'end;
   if due_at>=started and due_at<at_time then
    perform public.task_app_emit_notification(m.owner_id,m.id,'overdue:'||t.id||':'||due_at,'overdue',t.id,t.title,category,null,jsonb_build_object('dueAt',due_at),due_at,true);
   end if;
  end if;
  if t.assigned_to_member_id is null or t.assigned_to_member_id=m.id then continue;end if;
  for a in select * from public.account_member_absences where owner_id=m.owner_id and member_id=t.assigned_to_member_id and category_id=t.category_id and created_at>=started and cancelled_at is null and expires_at>at_time loop
   if not public.task_app_absence_covers(t,a,at_time)or exists(select 1 from public.task_coverage_claims where task_id=t.id and absence_id=a.id)then continue;end if;
   helper:=t;helper.assigned_to_member_id:=m.id;
   if exists(select 1 from public.account_member_absences own_absence where own_absence.owner_id=m.owner_id and public.task_app_absence_covers(helper,own_absence,at_time))then continue;end if;
   perform public.task_app_emit_notification(m.owner_id,m.id,'available:'||t.id||':'||a.id,'task_available',t.id,t.title,category,a.member_id,jsonb_build_object('absenceId',a.id),greatest(t.created_at,a.created_at,coalesce(t.available_at,a.created_at)),true);
  end loop;
 end loop;
end;$$;

create function public.task_app_notification_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;result jsonb;
begin
 m:=public.task_app_require_role();
 select jsonb_build_object('count',count(*),'snapshot',md5(coalesce(string_agg(id::text,'|'order by id),'')))into result from public.task_notifications where owner_id=m.owner_id and recipient_id=m.id;
 return result;
end;$$;

create function public.task_app_notifications()returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;n public.task_notifications;t public.tasks;a public.account_member_absences;helper public.tasks;
 q public.task_reopen_requests;entries jsonb:='[]';requests jsonb;pref public.task_notification_preferences;
 take_allowed boolean;request_allowed boolean;taken_name text;actor_label text;at_time timestamptz:=clock_timestamp();
begin
 m:=public.task_app_require_role();perform public.task_app_catchup_notifications();perform public.task_app_refresh_reopen_requests(m.owner_id);
 select * into pref from public.task_notification_preferences where member_id=m.id and owner_id=m.owner_id;
 if(select count(*)from public.task_notifications where recipient_id=m.id and owner_id=m.owner_id)>10000
 or(select count(*)from public.task_reopen_requests where owner_id=m.owner_id and(requester_id=m.id or reviewer_id=m.id))>10000 then raise exception 'Inbox limit reached; clear messages first'using errcode='P0013';end if;
 for n in select * from public.task_notifications where owner_id=m.owner_id and recipient_id=m.id order by created_at desc,id desc loop
  select * into t from public.tasks where id=n.task_id and owner_id=m.owner_id and deleted_at is null;
  take_allowed:=false;request_allowed:=false;taken_name:=null;q:=null;
  if n.kind='task_available'then
   select am.name into taken_name from public.task_coverage_claims cl join public.account_members am on am.id=cl.taken_by_member_id and am.owner_id=cl.owner_id where cl.task_id=n.task_id and cl.absence_id=(n.payload->>'absenceId')::uuid;
   select * into a from public.account_member_absences where id=(n.payload->>'absenceId')::uuid and owner_id=m.owner_id and cancelled_at is null;
   take_allowed:=t.id is not null and a.id is not null and public.task_app_absence_covers(t,a,at_time)and taken_name is null and t.assigned_to_member_id<>m.id
    and exists(select 1 from public.account_members where id=t.assigned_to_member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null);
   if take_allowed then helper:=t;helper.assigned_to_member_id:=m.id;
    take_allowed:=not exists(select 1 from public.account_member_absences oa where oa.owner_id=m.owner_id and public.task_app_absence_covers(helper,oa,at_time));end if;
  elsif n.kind='missed'then
   select * into q from public.task_reopen_requests where owner_id=m.owner_id and task_id=n.task_id and completed_at=(n.payload->>'completedAt')::timestamptz and requester_id=m.id;
   request_allowed:=q.id is null and t.id is not null and t.status='completed'and t.missed_completion_role is not null and t.completed_at=(n.payload->>'completedAt')::timestamptz and t.assigned_to_member_id=m.id
    and exists(select 1 from public.account_members where id=t.completed_by_member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null);
  end if;
  select coalesce(am.name,n.actor_name)into actor_label from(select 1)x left join public.account_members am on am.id=n.actor_id and am.owner_id=n.owner_id;
  entries:=entries||jsonb_build_array(jsonb_build_object('id',n.id,'kind',n.kind,'taskId',n.task_id,'title',n.task_title,'category',n.category_name,'actorName',actor_label,'payload',n.payload,'createdAt',n.created_at,'readAt',n.read_at,
   'taskAvailable',t.id is not null and(t.available_at is null or t.available_at<=at_time),'canTake',coalesce(take_allowed,false),'takenBy',taken_name,'canRequest',coalesce(request_allowed,false),'requestId',q.id,'requestStatus',q.status));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'taskId',r.task_id,'title',r.task_title,'requesterId',r.requester_id,'requesterName',sender.name,'reviewerId',r.reviewer_id,'reviewerName',reviewer.name,'completedAt',r.completed_at,'reason',r.reason,'status',r.status,'createdAt',r.created_at,'version',r.updated_at,'unavailableReason',r.unavailable_reason,'canReview',r.status='pending'and r.reviewer_id=m.id)order by r.created_at desc,r.id desc),'[]')into requests
 from public.task_reopen_requests r join public.account_members sender on sender.id=r.requester_id and sender.owner_id=r.owner_id join public.account_members reviewer on reviewer.id=r.reviewer_id and reviewer.owner_id=r.owner_id
 where r.owner_id=m.owner_id and(r.requester_id=m.id or r.reviewer_id=m.id);
 return jsonb_build_object('serverNow',at_time,'currentId',m.id,'entries',entries,'requests',requests,'preferences',jsonb_build_object('availability',pref.availability,'coverageUpdates',pref.coverage_updates,'reassignments',pref.reassignments));
end;$$;

create function public.task_app_read_notifications(ids uuid[])returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;at_time timestamptz:=clock_timestamp();marked jsonb;
begin
 m:=public.task_app_require_role();
 if ids is null or cardinality(ids)not between 1 and 100 or cardinality(ids)<>(select count(distinct x)from unnest(ids)x)
 or exists(select 1 from unnest(ids)x where x is null or not exists(select 1 from public.task_notifications where id=x and owner_id=m.owner_id and recipient_id=m.id))then raise exception 'Messages changed; refresh'using errcode='P0409';end if;
 update public.task_notifications set read_at=at_time where id=any(ids)and owner_id=m.owner_id and recipient_id=m.id and read_at is null;
 select jsonb_agg(jsonb_build_object('id',id,'readAt',read_at))into marked from public.task_notifications where id=any(ids)and owner_id=m.owner_id and recipient_id=m.id;
 return jsonb_build_object('marked',marked);
end;$$;
create function public.task_app_save_notification_preferences(availability boolean,coverage_updates boolean,reassignments boolean)returns void language plpgsql security definer set search_path='' as $$
declare m public.account_members;
begin
 m:=public.task_app_require_role();if availability is null or coverage_updates is null or reassignments is null then raise exception 'Invalid preferences'using errcode='23514';end if;
 update public.task_notification_preferences p set availability=task_app_save_notification_preferences.availability,coverage_updates=task_app_save_notification_preferences.coverage_updates,reassignments=task_app_save_notification_preferences.reassignments where p.member_id=m.id and p.owner_id=m.owner_id;
end;$$;
create function public.task_app_clear_notifications(expected_count integer,expected_snapshot text,confirmed boolean default false)returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;actual jsonb;deleted integer;
begin
 m:=public.task_app_require_role();if confirmed is distinct from true or expected_count is null or expected_count<0 or expected_snapshot is null or expected_snapshot!~'^[0-9a-f]{32}$'then raise exception 'Confirm clearing messages'using errcode='23514';end if;
 perform 1 from public.task_notification_preferences where owner_id=m.owner_id and member_id=m.id for update;
 actual:=public.task_app_notification_snapshot();
 if(actual->>'count')::integer<>expected_count or actual->>'snapshot'<>expected_snapshot then raise exception 'Messages changed; review before clearing'using errcode='P0409';end if;
 update public.task_notification_preferences set cleared_through=clock_timestamp()where owner_id=m.owner_id and member_id=m.id;
 delete from public.task_notifications where owner_id=m.owner_id and recipient_id=m.id;get diagnostics deleted=row_count;
 return jsonb_build_object('deleted',deleted);
end;$$;

create function public.task_app_request_reopening(task_id uuid,completed_at timestamptz,reason text,confirmed boolean default false)returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;t public.tasks;r public.task_reopen_requests;
begin
 m:=public.task_app_require_role();if confirmed is distinct from true or reason not in('Marked completed by mistake','Work needs correction','Work is not finished')or reason is null then raise exception 'Choose a request reason and confirm'using errcode='23514';end if;
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is null then raise exception 'Task changed; refresh'using errcode='P0409';end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,t.id)::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null for update;
 if t.id is null or t.status<>'completed'or t.missed_completion_role is null or t.completed_at is distinct from task_app_request_reopening.completed_at then raise exception 'Completion changed; refresh'using errcode='P0409';end if;
 if t.assigned_to_member_id is distinct from m.id then raise exception 'Only the affected assignee can request reopening'using errcode='P0403';end if;
 if not exists(select 1 from public.account_members where id=t.completed_by_member_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null)then raise exception 'Recorded completer unavailable'using errcode='P0409';end if;
 insert into public.task_reopen_requests(owner_id,task_id,task_title,requester_id,reviewer_id,completed_at,reason)
 values(m.owner_id,t.id,t.title,m.id,t.completed_by_member_id,t.completed_at,reason)
 on conflict on constraint reopen_occurrence_request_key do nothing;
 select * into r from public.task_reopen_requests q where q.owner_id=m.owner_id and q.task_id=t.id and q.completed_at=t.completed_at and q.requester_id=m.id;
 perform public.task_app_emit_notification(m.owner_id,r.reviewer_id,'request:'||r.id,'request_received',t.id,t.title,null,m.id,jsonb_build_object('requestId',r.id),r.created_at,true);
 return jsonb_build_object('id',r.id,'status',r.status);
end;$$;

create function public.task_app_review_reopening(request_id uuid,expected_version timestamptz,decision text,confirmed boolean default false)returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;r public.task_reopen_requests;t public.tasks;result jsonb;
begin
 m:=public.task_app_require_role();if confirmed is distinct from true or decision not in('approved','declined')or decision is null then raise exception 'Confirm request decision'using errcode='23514';end if;
 select * into r from public.task_reopen_requests where id=request_id and owner_id=m.owner_id;
 if r.id is null then raise exception 'Request changed; refresh'using errcode='P0409';end if;
 if r.reviewer_id<>m.id then raise exception 'Only recorded completer can review'using errcode='P0403';end if;
 select * into t from public.tasks where id=r.task_id and owner_id=m.owner_id;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(t.series_id,r.task_id)::text,0));
 select * into t from public.tasks where id=r.task_id and owner_id=m.owner_id for update;
 select * into r from public.task_reopen_requests where id=request_id and owner_id=m.owner_id for update;
 if r.status<>'pending'or r.updated_at is distinct from expected_version then raise exception 'Request changed; refresh'using errcode='P0409';end if;
 if not exists(select 1 from public.account_members where id=r.requester_id and owner_id=m.owner_id and left_at is null and auth_user_id is not null)or t.id is null or t.deleted_at is not null or t.status<>'completed'or t.missed_completion_role is null or t.completed_at<>r.completed_at or t.completed_by_member_id<>m.id or t.assigned_to_member_id<>r.requester_id then raise exception 'Completion changed; refresh'using errcode='P0409';end if;
 update public.task_reopen_requests set status=decision,updated_at=clock_timestamp()where id=r.id returning * into r;
 if decision='approved'then
  result:=public.task_app_mutate(t.id,t.updated_at,'status',null,'active','this',null);
  if result is null or coalesce((result->>'conflict')::boolean,false)or result->>'status'<>'active'then raise exception 'Task changed; no request decision saved'using errcode='P0409';end if;
 end if;
 perform public.task_app_notify_request_result(r);
 return jsonb_build_object('id',r.id,'status',r.status);
end;$$;

create trigger notifications_live_sync after insert or update or delete on public.task_notifications for each row execute function public.task_app_notify_sync('tasks');
create trigger reopen_requests_live_sync after insert or update on public.task_reopen_requests for each row execute function public.task_app_notify_sync('tasks');
create trigger notification_preferences_live_sync after update on public.task_notification_preferences for each row execute function public.task_app_notify_sync('tasks');
revoke all on function public.task_app_init_notification_preferences(),public.task_app_emit_notification(uuid,uuid,text,text,uuid,text,text,uuid,jsonb,timestamptz,boolean),public.task_app_notify_request_result(public.task_reopen_requests),public.task_app_refresh_reopen_requests(uuid),public.task_app_task_notification_events(),public.task_app_claim_notification_event(),public.task_app_fine_notification_event(),public.task_app_role_notification_event(),public.task_app_catchup_notifications(),public.task_app_emit_availability(public.tasks,timestamptz),public.task_app_absence_notification_event(),public.task_app_notification_snapshot(),public.task_app_notifications(),public.task_app_read_notifications(uuid[]),public.task_app_save_notification_preferences(boolean,boolean,boolean),public.task_app_clear_notifications(integer,text,boolean),public.task_app_request_reopening(uuid,timestamptz,text,boolean),public.task_app_review_reopening(uuid,timestamptz,text,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_notification_snapshot(),public.task_app_notifications(),public.task_app_read_notifications(uuid[]),public.task_app_save_notification_preferences(boolean,boolean,boolean),public.task_app_clear_notifications(integer,text,boolean),public.task_app_request_reopening(uuid,timestamptz,text,boolean),public.task_app_review_reopening(uuid,timestamptz,text,boolean)to authenticated;
notify pgrst,'reload schema';
commit;
