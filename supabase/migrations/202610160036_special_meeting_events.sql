-- LOCAL ONLY: bounded Special Meeting schedules. Does not enable jobs or delete records.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
do $$begin
 if to_regclass('public.task_special_meetings')is not null then raise exception '036 already installed; never replay';end if;
 if to_regclass('public.task_activity_retention_configuration')is null then raise exception 'Install reviewed001–035 first';end if;
end;$$;
lock table public.tasks in access exclusive mode;
create temporary table special_original_tasks on commit drop as select id,to_jsonb(t) original from public.tasks t;
create temporary table special_trigger_modes on commit drop as select tgname,tgenabled from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal;
create temporary table special_original_functions on commit drop as select oid,proowner,proacl,proconfig,prosecdef from pg_proc where pronamespace='public'::regnamespace;
create table public.task_special_meetings(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.task_workspaces(owner_id)on delete cascade,
 start_date date not null check(start_date between date '0001-01-01'and date '9999-11-30'),duration_days integer check(duration_days between 1 and 31),
 locked boolean not null default true,updated_at timestamptz not null default clock_timestamp(),unique(owner_id,id)
);
create unique index special_schedule_unique on public.task_special_meetings(owner_id,start_date,coalesce(duration_days,0));
create table public.task_special_plans(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,meeting_id uuid not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),enabled boolean not null default false,cancelled boolean not null default false,
 released_dates date[] not null default '{}',updated_at timestamptz not null default clock_timestamp(),foreign key(owner_id,meeting_id)references public.task_special_meetings(owner_id,id)on delete cascade,unique(owner_id,id)
);
create table public.task_special_activations(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,meeting_id uuid not null,opened_at timestamptz not null,closed_at timestamptz,
 foreign key(owner_id,meeting_id)references public.task_special_meetings(owner_id,id)on delete cascade,check(closed_at is null or closed_at>=opened_at)
);
create unique index special_one_open_interval on public.task_special_activations(meeting_id)where closed_at is null;
alter table public.tasks add column special_plan_id uuid,add column special_enabled boolean not null default false,
 add constraint task_special_plan_workspace foreign key(owner_id,special_plan_id)references public.task_special_plans(owner_id,id)on delete restrict;
alter table public.tasks drop constraint tasks_history_requires_successor;
alter table public.tasks add constraint tasks_history_requires_successor check(history_at is null or next_occurrence_id is not null or special_plan_id is not null);
create unique index special_daily_occurrence on public.tasks(special_plan_id,due_date)where special_plan_id is not null;
alter table public.task_special_meetings enable row level security;alter table public.task_special_plans enable row level security;alter table public.task_special_activations enable row level security;
revoke all on public.task_special_meetings,public.task_special_plans,public.task_special_activations from public,anon,authenticated,service_role;
create function public.task_app_special_end(e public.task_special_meetings)returns timestamptz language sql immutable set search_path=''as $$select(e.start_date+coalesce(e.duration_days,2))::timestamp at time zone 'Asia/Kolkata'$$;
create function public.task_app_special_active(own uuid,at_time timestamptz)returns uuid language sql stable security definer set search_path=''as $$
 select id from public.task_special_meetings e where owner_id=own and not locked and at_time>=e.start_date::timestamp at time zone 'Asia/Kolkata'and at_time<public.task_app_special_end(e)order by start_date,id limit 1
$$;
create function public.task_app_special_task_open(t public.tasks,at_time timestamptz)returns boolean language sql stable security definer set search_path=''as $$
 select coalesce(exists(select 1 from public.task_special_plans p join public.task_special_meetings e on e.id=p.meeting_id and e.owner_id=p.owner_id
 where p.id=t.special_plan_id and p.owner_id=t.owner_id and p.enabled and t.special_enabled and not e.locked
 and at_time>=e.start_date::timestamp at time zone 'Asia/Kolkata'and at_time<public.task_app_special_end(e)),false)
$$;
-- Persist replacement eligibility through relock/expiry; late Cron must never charge a covered occurrence retrospectively.
create function public.task_app_special_replaced(own uuid,category_name text,scheduled_date date,at_time timestamptz)returns boolean language plpgsql stable security definer set search_path=''as $$
declare target integer;day date;begins timestamptz;ends_at timestamptz;
begin
 target:=case category_name when 'Sunday Service'then 0 when 'Healing Meeting'then 3 when 'Revival Meeting'then 5 else null end;
 if target is null or scheduled_date is null then return false;end if;
 day:=scheduled_date-((extract(dow from scheduled_date)::integer-target+7)%7);
 begins:=day::timestamp at time zone 'Asia/Kolkata';ends_at:=(day+2)::timestamp at time zone 'Asia/Kolkata';
 return exists(select 1 from public.task_special_activations a join public.task_special_meetings e on e.id=a.meeting_id and e.owner_id=a.owner_id
 where a.owner_id=own and greatest(a.opened_at,e.start_date::timestamp at time zone 'Asia/Kolkata',begins)<least(coalesce(a.closed_at,'infinity'::timestamptz),public.task_app_special_end(e),ends_at,at_time));
end;$$;
create function public.task_app_special_state()returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;
begin
 m:=public.task_app_require_role();
 if(select count(*)from public.task_special_meetings where owner_id=m.owner_id)>10000 then raise exception 'Too many meeting schedules'using errcode='P0409';end if;
 return jsonb_build_object('serverNow',clock_timestamp(),'meetings',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'startDate',e.start_date,'days',e.duration_days,'locked',e.locked,'version',e.updated_at,'startsAt',e.start_date::timestamp at time zone 'Asia/Kolkata','endsAt',public.task_app_special_end(e))order by start_date,id),'[]')from public.task_special_meetings e where owner_id=m.owner_id),
 'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'meetingId',meeting_id,'version',updated_at,'enabled',enabled,'cancelled',cancelled)),'[]')from public.task_special_plans where owner_id=m.owner_id));
end;$$;
-- Adopt existing Special rows with metadata only. No old fields, versions, schedules, accounts or fines change.
do $$declare t public.tasks;e uuid;p uuid;x record;begin
 for x in select * from special_trigger_modes loop execute format('alter table public.tasks disable trigger %I',x.tgname);end loop;
 for t in select existing.* from public.tasks existing join public.categories c on c.id=existing.category_id and c.owner_id=existing.owner_id where c.name='Special Meeting'loop
  insert into public.task_special_meetings(owner_id,start_date)values(t.owner_id,coalesce(t.due_date,(t.created_at at time zone 'Asia/Kolkata')::date))on conflict do nothing;
  select id into e from public.task_special_meetings where owner_id=t.owner_id and start_date=coalesce(t.due_date,(t.created_at at time zone 'Asia/Kolkata')::date)and duration_days is null;
  insert into public.task_special_plans(owner_id,meeting_id,payload,cancelled,released_dates)values(t.owner_id,e,to_jsonb(t),t.deleted_at is not null,array[coalesce(t.due_date,(t.created_at at time zone 'Asia/Kolkata')::date)]) returning id into p;
  update public.tasks set special_plan_id=p where id=t.id;
 end loop;
 for x in select * from special_trigger_modes loop execute format('alter table public.tasks %s trigger %I',case x.tgenabled when 'D'then'disable'when 'A'then'enable always'when 'R'then'enable replica'else'enable'end,x.tgname);end loop;
end;$$;
create function public.task_app_prepare_special(own uuid,f jsonb)returns uuid language plpgsql security definer set search_path=''as $$
declare e public.task_special_meetings;p uuid;days integer:=(f->>'special_days')::integer;day date:=(f->>'due_date')::date;
begin
 if day is null or day>date '9999-11-30'or(days is not null and days not between 1 and 31)then raise exception 'Choose a Special Meeting start date and optional1–31days'using errcode='23514';end if;
 insert into public.task_special_meetings(owner_id,start_date,duration_days)values(own,day,days)on conflict do nothing;
 select * into e from public.task_special_meetings where owner_id=own and start_date=day and duration_days is not distinct from days for update;
 if public.task_app_special_end(e)<=clock_timestamp()then raise exception 'This meeting schedule has ended'using errcode='P0409';end if;
 insert into public.task_special_plans(owner_id,meeting_id,payload)values(own,e.id,(f-'special_days')||jsonb_build_object('repeat_rule','off','weekdays','[]'::jsonb))returning id into p;
 return p;
end;$$;
create function public.task_app_release_special(own uuid,at_time timestamptz)returns bigint language plpgsql security definer set search_path=''as $$
declare p record;day date:=(at_time at time zone 'Asia/Kolkata')::date;n bigint:=0;
begin
 if at_time is null or not isfinite(at_time)then raise exception 'Server time required'using errcode='23514';end if;
 for p in select plan.*,e.start_date,e.duration_days from public.task_special_plans plan join public.task_special_meetings e on e.id=plan.meeting_id and e.owner_id=plan.owner_id
 where not plan.cancelled and e.duration_days is not null and day>=e.start_date and day<e.start_date+e.duration_days and(own is null or plan.owner_id=own)order by plan.owner_id,plan.id loop
  if not pg_try_advisory_xact_lock(hashtextextended('special:'||p.owner_id::text,0))then continue;end if;
  perform 1 from public.task_special_plans where id=p.id for update;
  if exists(select 1 from public.task_special_plans where id=p.id and day=any(released_dates))then continue;end if;
  if not exists(select 1 from public.account_members where owner_id=p.owner_id and id=(p.payload->>'assigned_to_member_id')::uuid and left_at is null and auth_user_id is not null)then continue;end if;
  insert into public.tasks(owner_id,title,notes,status,due_date,due_time,priority,category_id,weekdays,repeat_rule,assigned_to_member_id,special_plan_id,special_enabled)
  values(p.owner_id,p.payload->>'title',p.payload->>'notes','active',day,(p.payload->>'due_time')::time,p.payload->>'priority',(p.payload->>'category_id')::uuid,'{}','off',(p.payload->>'assigned_to_member_id')::uuid,p.id,p.enabled);
  update public.tasks set history_at=coalesce(history_at,day::timestamp at time zone 'Asia/Kolkata')where special_plan_id=p.id and due_date<day and status='completed'and deleted_at is null;
  n:=n+1;
 end loop;
 update public.tasks t set history_at=public.task_app_special_end(e)from public.task_special_plans plan join public.task_special_meetings e on e.id=plan.meeting_id where t.special_plan_id=plan.id and t.status='completed'and t.deleted_at is null and t.history_at is null and public.task_app_special_end(e)<=at_time and(own is null or t.owner_id=own);
 return n;
end;$$;
create function public.task_app_set_special_locked(meeting_id uuid,expected_version timestamptz,locked boolean,confirmed boolean default false)returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;e public.task_special_meetings;at_time timestamptz;
begin
 m:=public.task_app_require_role(true);
 if confirmed is distinct from true or locked is null or expected_version is null or not isfinite(expected_version)then raise exception 'Confirm meeting change'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('special:'||m.owner_id::text,0));
 select * into e from public.task_special_meetings where id=meeting_id and owner_id=m.owner_id for update;
 if e.id is null or e.updated_at is distinct from expected_version then raise exception 'Meeting changed; refresh first'using errcode='P0409';end if;
 at_time:=clock_timestamp();
 if public.task_app_special_end(e)<=at_time then raise exception 'This meeting has ended'using errcode='P0409';end if;
 if not locked then
  if not exists(select 1 from public.tasks t join public.task_special_plans p on p.id=t.special_plan_id where p.meeting_id=e.id and t.deleted_at is null and not p.cancelled)then raise exception 'Add a task before activating this meeting'using errcode='P0409';end if;
  if exists(select 1 from public.task_special_meetings other where other.owner_id=m.owner_id and other.id<>e.id and not other.locked and other.start_date::timestamp at time zone 'Asia/Kolkata'<public.task_app_special_end(e)and e.start_date::timestamp at time zone 'Asia/Kolkata'<public.task_app_special_end(other))then raise exception 'Another activated Special Meeting overlaps these dates. Lock it first.'using errcode='P0037';end if;
 end if;
 update public.task_special_meetings set locked=task_app_set_special_locked.locked,updated_at=greatest(at_time,e.updated_at+interval '1 microsecond')where id=e.id;
 if locked then
  update public.task_special_activations a set closed_at=at_time where a.meeting_id=e.id and a.closed_at is null;
 else
  insert into public.task_special_activations(owner_id,meeting_id,opened_at)values(m.owner_id,e.id,at_time)on conflict do nothing;
  update public.task_special_plans p set enabled=true,updated_at=greatest(at_time,p.updated_at+interval '1 microsecond')where p.meeting_id=e.id and not p.cancelled;
  update public.tasks t set special_enabled=true from public.task_special_plans p where t.special_plan_id=p.id and p.meeting_id=e.id and t.deleted_at is null and not p.cancelled;
 end if;
 perform public.task_app_release_special(m.owner_id,at_time);
 return public.task_app_special_state();
end;$$;
create function public.task_app_special_task_guard()returns trigger language plpgsql security definer set search_path=''as $$
declare category_name text;p public.task_special_plans;e public.task_special_meetings;at_time timestamptz:=clock_timestamp();
begin
 select name into category_name from public.categories where id=new.category_id and owner_id=new.owner_id;
 if new.special_plan_id is not null then
  select * into p from public.task_special_plans where id=new.special_plan_id and owner_id=new.owner_id;
  select * into e from public.task_special_meetings where id=p.meeting_id and owner_id=p.owner_id;
  if category_name is distinct from 'Special Meeting'or(new.due_date is not null and(new.due_date<e.start_date or new.due_date>=e.start_date+coalesce(e.duration_days,1)))then raise exception 'Keep this occurrence within its Special Meeting schedule'using errcode='23514';end if;
  if tg_op='UPDATE'and new.status is distinct from old.status and not public.task_app_special_task_open(old,at_time)then raise exception 'Activate this Special Meeting before changing completion'using errcode='P0036';end if;
 elsif tg_op='UPDATE'and new.status is distinct from old.status and public.task_app_special_active(new.owner_id,at_time)is not null then raise exception 'Only the activated Special Meeting can be completed now'using errcode='P0036';end if;
 return new;
end;$$;
create trigger tasks_special_guard before insert or update on public.tasks for each row execute function public.task_app_special_task_guard();
-- Minimal materialized-date ledger survives completed-task purges. It carries no task content.
create function public.task_app_special_record_release()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.special_plan_id is not null then
 update public.task_special_plans set released_dates=array_append(released_dates,coalesce(new.due_date,(select start_date from public.task_special_meetings e where e.id=task_special_plans.meeting_id)))where id=new.special_plan_id and not(coalesce(new.due_date,(select start_date from public.task_special_meetings e where e.id=task_special_plans.meeting_id))=any(released_dates));
 end if;return null;end;$$;
create trigger tasks_special_release_record after insert on public.tasks for each row execute function public.task_app_special_record_release();
create function public.task_app_special_plan_cancel()returns trigger language plpgsql security definer set search_path=''as $$begin
 if old.special_plan_id is not null and((tg_op='UPDATE'and old.deleted_at is null and new.deleted_at is not null)or(tg_op='DELETE'and old.status='active'))then
 update public.task_special_plans set cancelled=true,updated_at=clock_timestamp()where id=old.special_plan_id;
 elsif tg_op='UPDATE'and old.special_plan_id is not null and old.deleted_at is not null and new.deleted_at is null then
 update public.task_special_plans set cancelled=false,updated_at=clock_timestamp()where id=old.special_plan_id;
 end if;return null;end;$$;
create trigger tasks_special_cancel after update or delete on public.tasks for each row execute function public.task_app_special_plan_cancel();
create trigger special_meetings_sync after insert or update on public.task_special_meetings for each row execute function public.task_app_notify_sync('tasks');
create trigger special_plans_sync after insert or update on public.task_special_plans for each row execute function public.task_app_notify_sync('tasks');
-- Guarded function edits preserve existing owners, grants and checks. Only exact reviewed shapes are accepted.
create function pg_temp.special_patch(signature text,needle text,replacement text,expected integer default 1)returns void language plpgsql as $$declare body text;matches integer;begin
 body:=pg_get_functiondef(signature::regprocedure);matches:=(length(body)-length(replace(body,needle,'')))/length(needle);
 if matches<>expected then raise exception 'Unexpected036 patch shape for% expected%, got%',signature,expected,matches;end if;execute replace(body,needle,replacement);
end;$$;
select pg_temp.special_patch('public.task_app_create_tasks(jsonb)','category_value text;','category_value text;special_plan uuid;category_name text;');
select pg_temp.special_patch('public.task_app_create_tasks(jsonb)','''sunday_service''))','''sunday_service'',''special_days''))');
select pg_temp.special_patch('public.task_app_create_tasks(jsonb)',' insert into public.tasks(owner_id,',' select name into category_name from public.categories where id=(f->>''category_id'')::uuid and owner_id=m.owner_id;
 special_plan:=null;
 if category_name=''Special Meeting''then
 perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));special_plan:=public.task_app_prepare_special(m.owner_id,f);
 f:=f||jsonb_build_object(''repeat_rule'',''off'',''weekdays'',''[]''::jsonb);
 elsif f ? ''special_days''then raise exception ''Duration is only for Special Meeting''using errcode=''23514'';end if;
 insert into public.tasks(owner_id,');
select pg_temp.special_patch('public.task_app_create_tasks(jsonb)','assigned_to_member_id,sunday_service)','assigned_to_member_id,sunday_service,special_plan_id)');
select pg_temp.special_patch('public.task_app_create_tasks(jsonb)','f->>''sunday_service'') returning * into t;','f->>''sunday_service'',special_plan) returning * into t;');
select pg_temp.special_patch('public.task_app_spawn_next()','begin','begin
 if new.special_plan_id is not null or exists(select 1 from public.categories where id=new.category_id and owner_id=new.owner_id and name=''Special Meeting'')then return null;end if;');
select pg_temp.special_patch('public.task_app_release_repeats(uuid,timestamptz)','order by series_id,id loop','and not exists(select 1 from public.categories c where c.owner_id=task_repeat_pending.owner_id and c.id=(task_repeat_pending.payload->>''category_id'')::uuid and c.name=''Special Meeting'') order by series_id,id loop');
select pg_temp.special_patch('public.task_app_release_repeats(uuid,timestamptz)','return released;','return released+public.task_app_release_special(owner_scope,release_when);');
select pg_temp.special_patch('public.task_app_fine_cutoff(text,date,time)','if category_name=''Special Meeting''then return((scheduled_date+1)+time ''01:00'')at time zone ''Asia/Kolkata'';end if;','if category_name=''Special Meeting''then return null;end if;');
select pg_temp.special_patch('public.task_app_finalize_fine(uuid,timestamptz)','if c.cutoff_at>activation','if c.category_name<>''Special Meeting'' and not public.task_app_special_replaced(c.owner_id,c.category_name,c.scheduled_date,c.cutoff_at) and c.cutoff_at>activation');
-- Missed timing now consults the locked event and final-day deadline; regular timing remains unchanged.
select pg_temp.special_patch('public.task_app_missed_timing_open(public.tasks,text,timestamptz)',' IMMUTABLE',' STABLE');
select pg_temp.special_patch('public.task_app_missed_timing_open(public.tasks,text,timestamptz)','created_day date;morning boolean;','created_day date;morning boolean;e public.task_special_meetings;');
select pg_temp.special_patch('public.task_app_missed_timing_open(public.tasks,text,timestamptz)',' if t.due_date is not null then return meeting_day=t.due_date;end if;',' select e1.* into e from public.task_special_plans p join public.task_special_meetings e1 on e1.id=p.meeting_id and e1.owner_id=p.owner_id where p.id=t.special_plan_id and p.owner_id=t.owner_id;
 if e.id is not null and(not public.task_app_special_task_open(t,at_time)or at_time>=public.task_app_special_end(e))then return false;end if;
 if t.due_date is not null then return meeting_day=t.due_date;end if;');
select pg_temp.special_patch('public.task_app_missed_timing_open(public.tasks,text,timestamptz)',' if target is not null then',' if target is not null then
  if public.task_app_special_active(t.owner_id,at_time)is not null or public.task_app_special_replaced(t.owner_id,category_name,coalesce(t.due_date,meeting_day),at_time)then return false;end if;');
do $$declare body text;a integer;b integer;begin
 body:=pg_get_functiondef('public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure);
 a:=position(' select enabled_at into activation'in body);b:=position(' on conflict on constraint task_fines_task_id_key do nothing;'in body)+length(' on conflict on constraint task_fines_task_id_key do nothing;');
 if a=0 or b<=a then raise exception 'Unexpected Missed fine block';end if;
 execute substr(body,1,a-1)||' if category_name<>''Special Meeting''then '||substr(body,a,b-a)||' end if;'||substr(body,b);
end;$$;
select pg_temp.special_patch('public.task_app_complete_missed(uuid,timestamptz,boolean)',' ends_at:=(meeting_day+2)::timestamp at time zone ''Asia/Kolkata'';',' ends_at:=case when category_name=''Special Meeting''then least((meeting_day+1+time ''01:00'')at time zone ''Asia/Kolkata'',(select public.task_app_special_end(e)from public.task_special_plans p join public.task_special_meetings e on e.id=p.meeting_id where p.id=t.special_plan_id))else(meeting_day+2)::timestamp at time zone ''Asia/Kolkata''end;');
-- Retain daily completion history under existing repeat-history retention, not the regular7day cleanup.
select pg_temp.special_patch('public.task_app_purge_history()','and repeat_rule=''off''and series_id is null','and special_plan_id is null and repeat_rule=''off''and series_id is null');
-- Retain every existing mutation check in a private copy, while routing bound Special plans separately.
do $$declare body text;begin
 body:=pg_get_functiondef('public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure);
 execute replace(body,'FUNCTION public.task_app_mutate(','FUNCTION public.task_app_before_special_mutate(');
end;$$;
revoke all on function public.task_app_before_special_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)from public,anon,authenticated,service_role;
create function public.task_app_mutate_special(task_id uuid,expected_version timestamptz,operation text,fields jsonb,new_status text,edit_scope text,expected_series_version timestamptz,assignment_future boolean default false)
returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;t public.tasks;p public.task_special_plans;e public.task_special_meetings;r jsonb;f jsonb;
begin
 m:=public.task_app_require_role(operation is distinct from 'status');
 perform pg_advisory_xact_lock(hashtextextended('special:'||m.owner_id::text,0));
 select * into t from public.tasks where id=task_id and owner_id=m.owner_id and deleted_at is null;
 if t.id is null then return null;end if;
 select * into p from public.task_special_plans where id=t.special_plan_id and owner_id=m.owner_id for update;
 select * into e from public.task_special_meetings where id=p.meeting_id and owner_id=p.owner_id;
 if p.id is null then raise exception 'This is not a Special Meeting occurrence'using errcode='23514';end if;
 if edit_scope='future'or assignment_future then
  if exists(select 1 from public.tasks later where later.special_plan_id=p.id and later.due_date>t.due_date and later.deleted_at is null)then raise exception 'Open the current day occurrence to change future tasks'using errcode='P0409';end if;
  if expected_series_version is distinct from p.updated_at then return jsonb_build_object('conflict',true,'series_version',p.updated_at);end if;
 end if;
 f:=fields;
 if operation='update'then
  if fields->>'special_days'is distinct from e.duration_days::text or((fields->>'due_date')::date is distinct from t.due_date and not(t.due_date is null and(fields->>'due_date')::date=e.start_date))or(fields->>'category_id')::uuid is distinct from t.category_id then raise exception 'This occurrence belongs to its saved Special Meeting schedule'using errcode='23514';end if;
  f:=(fields-'special_days')||jsonb_build_object('repeat_rule','off','weekdays','[]'::jsonb);
 end if;
 r:=public.task_app_before_special_mutate(task_id,expected_version,operation,f,new_status,'this',expected_version);
 if r is null or coalesce((r->>'conflict')::boolean,false)then return r;end if;
 if operation='update'and(edit_scope='future'or assignment_future)then
  update public.task_special_plans set payload=case when edit_scope='future'then f||jsonb_build_object('status','active','assigned_to_member_id',case when assignment_future then f->>'assigned_to_member_id'else payload->>'assigned_to_member_id'end)else payload||jsonb_build_object('assigned_to_member_id',f->>'assigned_to_member_id')end,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')where id=p.id returning * into p;
 end if;
 return r||jsonb_build_object('series_version',p.updated_at);
end;$$;
select pg_temp.special_patch('public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)','begin','begin
 if exists(select 1 from public.tasks where id=task_id and special_plan_id is not null)then
 return public.task_app_mutate_special(task_id,expected_version,operation,fields,new_status,edit_scope,expected_series_version,false);end if;');
create function public.task_app_reassign_special(task_id uuid,expected_version timestamptz,operation text,fields jsonb,new_status text,edit_scope text,expected_series_version timestamptz)
returns jsonb language plpgsql security definer set search_path=''as $$begin
 perform public.task_app_require_role(true);
 if operation is distinct from 'update'then raise exception 'Reassignment requires an edit'using errcode='23514';end if;
 return public.task_app_mutate_special(task_id,expected_version,operation,fields,new_status,edit_scope,expected_series_version,true);
end;$$;
-- Attendance uses today's event occurrence; locked meetings cannot release work or hide a regular absence.
select pg_temp.special_patch('public.task_app_attendance_change_open(text,date,timestamptz)',' IMMUTABLE',' STABLE');
select pg_temp.special_patch('public.task_app_attendance_change_open(text,date,timestamptz)',' if category_name=''Special Meeting'' then',' if category_name<>''Special Meeting''and public.task_app_special_active(public.task_app_workspace_owner(),at_time)is not null then return false;end if;
 if category_name=''Special Meeting'' then
  if not exists(select 1 from public.task_special_meetings e where e.owner_id=public.task_app_workspace_owner()and e.id=public.task_app_special_active(e.owner_id,at_time)and selected_date>=e.start_date and selected_date<e.start_date+coalesce(e.duration_days,1))then return false;end if;');
select pg_temp.special_patch('public.task_app_service_attendance_open(text,timestamptz)',' IMMUTABLE',' STABLE');
select pg_temp.special_patch('public.task_app_service_attendance_open(text,timestamptz)','select coalesce(isfinite(at_time)and','select coalesce(public.task_app_special_active(public.task_app_workspace_owner(),at_time)is null and isfinite(at_time)and');
select pg_temp.special_patch('public.task_app_mark_absent(uuid,date,boolean)','ends_at:=((selected_date+2)+time ''00:00'') at time zone ''Asia/Kolkata'';','ends_at:=least(((selected_date+1)+time ''01:00'')at time zone ''Asia/Kolkata'',(select public.task_app_special_end(e)from public.task_special_meetings e where e.id=public.task_app_special_active(m.owner_id,clock_timestamp())));');
-- Ignore another event day’s active marks when finding today's existing absence.
select pg_temp.special_patch('public.task_app_mark_absent(uuid,date,boolean)','and cancelled_at is null and expires_at>clock_timestamp() for update;','and cancelled_at is null and expires_at>clock_timestamp()and(c.name<>''Special Meeting''or meeting_date=selected_date)for update;');
select pg_temp.special_patch('public.task_app_absence_covers(public.tasks,public.account_member_absences,timestamptz)',' if a.restriction_role is not null then return false;end if;',' if a.restriction_role is not null then return false;end if;
 if t.special_plan_id is not null and not public.task_app_special_task_open(t,at_time)then return false;end if;
 if t.special_plan_id is null and public.task_app_special_active(t.owner_id,at_time)is not null then return false;end if;');
select pg_temp.special_patch('public.task_app_restriction_covers(public.tasks,public.account_member_absences,timestamptz)','begin','begin
 if t.special_plan_id is not null and not public.task_app_special_task_open(t,at_time)then return false;end if;
 if t.special_plan_id is null and public.task_app_special_active(t.owner_id,at_time)is not null then return false;end if;');
-- Report the same activated schedule and exact event expiry; annual totals are untouched.
select pg_temp.special_patch('public.task_app_member_history()','public.task_app_history_expires(c.name,t.completed_at,t.due_date,t.weekdays) as ends_at','coalesce((select public.task_app_special_end(e)from public.task_special_plans p join public.task_special_meetings e on e.id=p.meeting_id and e.owner_id=p.owner_id where p.id=t.special_plan_id and p.owner_id=t.owner_id),public.task_app_history_expires(c.name,t.completed_at,t.due_date,t.weekdays)) as ends_at');
-- Replace only the derived specialWindows query; all existing membership/credit filters stay in place.
do $$declare body text;first_pos integer;last_pos integer;begin
 body:=pg_get_functiondef('public.task_app_member_history()'::regprocedure);
 first_pos:=position(' with special as('in body);last_pos:=position(' return jsonb_build_object(''serverNow'''in body);
 if first_pos=0 or last_pos<=first_pos then raise exception 'Unexpected history schedule definition';end if;
 body:=substr(body,1,first_pos-1)||' select coalesce(jsonb_agg(jsonb_build_object(''startsAt'',e.start_date::timestamp at time zone ''Asia/Kolkata'',''endsAt'',public.task_app_special_end(e))order by e.start_date),''[]''::jsonb)into windows from public.task_special_meetings e where e.owner_id=own_id and not e.locked and public.task_app_special_end(e)>current_time_value;'||substr(body,last_pos);
 execute body;
end;$$;
-- Serialize user actions against lock/unlock before their task/attendance row locks.
select pg_temp.special_patch('public.task_app_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)','begin','begin
 perform pg_advisory_xact_lock(hashtextextended(''special:''||public.task_app_workspace_owner()::text,0));');
select pg_temp.special_patch('public.task_app_complete_missed(uuid,timestamptz,boolean)',' m:=public.task_app_require_role(true);',' m:=public.task_app_require_role(true);perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));',2);
select pg_temp.special_patch('public.task_app_mark_absent(uuid,date,boolean)',' m:=public.task_app_require_role();',' m:=public.task_app_require_role();perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));');
select pg_temp.special_patch('public.task_app_unmark_absent(uuid,timestamptz,boolean)',' m:=public.task_app_require_role();',' m:=public.task_app_require_role();perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));');
select pg_temp.special_patch('public.task_app_mark_service_absent(uuid,text,boolean)',' m:=public.task_app_require_role();',' m:=public.task_app_require_role();perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));');
select pg_temp.special_patch('public.task_app_unmark_service_absent(uuid,timestamptz,text,boolean)',' m:=public.task_app_require_role();',' m:=public.task_app_require_role();perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));');
select pg_temp.special_patch('public.task_app_take_task(uuid,timestamptz,uuid,boolean)',' m:=public.task_app_require_role();',' m:=public.task_app_require_role();perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));');
select pg_temp.special_patch('public.task_app_review_reopening(uuid,timestamptz,text,boolean)',' m:=public.task_app_require_role();',' m:=public.task_app_require_role();perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));');
-- Fines maintenance never waits holding a candidate row across activation.
select pg_temp.special_patch('public.task_app_finalize_fine(uuid,timestamptz)',' select enabled_at into activation',' if not coalesce(pg_try_advisory_xact_lock(hashtextextended(''special:''||(select owner_id::text from public.task_fine_candidates where task_id=candidate_id),0)),true)then return;end if;
 select enabled_at into activation');
select pg_temp.special_patch('public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)',' m:=public.task_app_require_role(true);',' m:=public.task_app_require_role(true);perform pg_advisory_xact_lock(hashtextextended(''special:''||m.owner_id::text,0));');
-- Private helpers never receive API grants; existing role/identity checks are retained.
do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_special_end','task_app_special_active','task_app_special_task_open','task_app_special_replaced','task_app_prepare_special','task_app_release_special','task_app_special_task_guard','task_app_special_plan_cancel','task_app_special_record_release','task_app_mutate_special')loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end;$$;
revoke all on function public.task_app_special_state(),public.task_app_set_special_locked(uuid,timestamptz,boolean,boolean),public.task_app_reassign_special(uuid,timestamptz,text,jsonb,text,text,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.task_app_special_state(),public.task_app_set_special_locked(uuid,timestamptz,boolean,boolean),public.task_app_reassign_special(uuid,timestamptz,text,jsonb,text,text,timestamptz)to authenticated;
do $$begin
 if exists(select 1 from special_original_tasks b full join public.tasks t using(id)where t.id is null or b.id is null or to_jsonb(t)-'special_plan_id'-'special_enabled'is distinct from b.original)then raise exception '036 altered existing task data';end if;
 if exists(select 1 from special_original_functions b join pg_proc p using(oid)where p.proowner is distinct from b.proowner or p.proacl is distinct from b.proacl or p.proconfig is distinct from b.proconfig or p.prosecdef is distinct from b.prosecdef)then raise exception '036 changed existing function access';end if;
 if exists(select 1 from special_trigger_modes b join pg_trigger t on t.tgrelid='public.tasks'::regclass and t.tgname=b.tgname where b.tgenabled<>t.tgenabled)then raise exception '036 changed trigger state';end if;
end;$$;
notify pgrst,'reload schema';commit;
