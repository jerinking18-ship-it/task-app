-- LOCAL ONLY. Apply once after publication approval. No backfill, cleanup or job changes.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if to_regclass('public.task_member_check_ins')is not null then raise exception '041 already installed; never replay';end if;
 if to_regprocedure('public.task_app_reassign_all(uuid,timestamp with time zone,uuid,text,boolean,jsonb)')is null
 or to_regclass('public.task_special_meetings')is null then raise exception 'Install reviewed001–039 first';end if;
end;$$;
create table public.task_member_check_ins(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,member_id uuid not null,category_id uuid not null,
 meeting_date date not null check(meeting_date between date '0001-01-01'and date '9999-11-30'),
 service text not null default ''check(service in('','morning','evening')),meeting_id uuid,
 checked_at timestamptz not null default clock_timestamp()check(isfinite(checked_at)),
 foreign key(owner_id,member_id)references public.account_members(owner_id,id)on delete cascade,
 foreign key(owner_id,category_id)references public.categories(owner_id,id)on delete cascade,
 foreign key(owner_id,meeting_id)references public.task_special_meetings(owner_id,id)on delete cascade,
 check(meeting_id is null or service='')
);
create unique index member_check_in_scope on public.task_member_check_ins(owner_id,member_id,category_id,meeting_date,service,coalesce(meeting_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index member_check_in_meeting on public.task_member_check_ins(owner_id,meeting_date);
alter table public.task_member_check_ins enable row level security;
revoke all on public.task_member_check_ins from public,anon,authenticated,service_role;

create function public.task_app_check_in_contexts(own uuid,at_time timestamptz)
returns table(category_id uuid,category_name text,meeting_date date,service text,meeting_id uuid,opens_at timestamptz,closes_at timestamptz,visible_until timestamptz)
language plpgsql stable security definer set search_path=''as $$
declare day date:=(at_time at time zone 'Asia/Kolkata')::date;weekday integer:=extract(dow from day)::integer;
 e public.task_special_meetings;chosen_name text;start_day date;
begin
 select * into e from public.task_special_meetings where id=public.task_app_special_active(own,at_time);
 if e.id is not null then
  start_day:=case when e.duration_days is null then e.start_date else day end;
  return query select c.id,c.name,start_day,''::text,e.id,(start_day+time '07:00')at time zone 'Asia/Kolkata',
   (start_day+time '23:00')at time zone 'Asia/Kolkata',public.task_app_special_end(e)
   from public.categories c where c.owner_id=own and c.name='Special Meeting';
  return;
 end if;
 chosen_name:=case weekday when 0 then 'Sunday Service'when 1 then 'Sunday Service'when 3 then 'Healing Meeting'when 4 then 'Healing Meeting'when 5 then 'Revival Meeting'when 6 then 'Revival Meeting'end;
 if chosen_name is null then return;end if;
 start_day:=day-case when weekday in(1,4,6)then 1 else 0 end;
 return query select c.id,c.name,start_day,s.value,null::uuid,
  (start_day+case when s.value='morning'then time '07:00'else time '16:00'end)at time zone 'Asia/Kolkata',
  (start_day::timestamp+case when s.value='morning'then interval '16 hours'else interval '1 day'end)at time zone 'Asia/Kolkata',
  (start_day+2)::timestamp at time zone 'Asia/Kolkata'
 from public.categories c cross join lateral(select unnest(case when chosen_name='Sunday Service'then array['morning','evening']else array['']end)value)s
 where c.owner_id=own and c.name=chosen_name;
end;$$;

create function public.task_app_check_in_state(details boolean default false)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.account_members;at_time timestamptz;contexts jsonb;people jsonb;own_keys jsonb;private_rows jsonb;
begin
 if details is null then raise exception 'Choose check-in view'using errcode='23514';end if;
 m:=public.task_app_require_role(details);at_time:=clock_timestamp();
 with scopes as(select *,category_id::text||':'||meeting_date::text||':'||service||':'||coalesce(meeting_id::text,'')key from public.task_app_check_in_contexts(m.owner_id,at_time)),
 checked as(select s.key,i.member_id,i.checked_at from public.task_member_check_ins i join scopes s on s.category_id=i.category_id and s.meeting_date=i.meeting_date and s.service=i.service and s.meeting_id is not distinct from i.meeting_id
 join public.account_members u on u.owner_id=i.owner_id and u.id=i.member_id and u.left_at is null and u.auth_user_id is not null where i.owner_id=m.owner_id)
 select (select coalesce(jsonb_agg(jsonb_build_object('categoryId',category_id,'category',category_name,'meetingDate',meeting_date,'service',nullif(service,''),'meetingId',meeting_id,'opensAt',opens_at,'closesAt',closes_at,'visibleUntil',visible_until)order by opens_at,key),'[]')from scopes),
 (select coalesce(jsonb_agg(jsonb_build_object('key',key,'memberId',member_id)order by key,member_id),'[]')from checked),
 (select coalesce(jsonb_agg(key order by key),'[]')from checked where member_id=m.id and not exists(select 1 from public.account_member_absences a join scopes s on s.key=checked.key where a.owner_id=m.owner_id and a.member_id=m.id and a.category_id=s.category_id and a.cancelled_at is null and a.restriction_role is null and a.created_at<=at_time and a.expires_at>at_time and(s.category_name<>'Special Meeting'or a.meeting_date=s.meeting_date)and(s.category_name<>'Sunday Service'or public.task_app_absence_service_covers(a,s.service,at_time)))),
 case when details then(select coalesce(jsonb_agg(jsonb_build_object('key',key,'memberId',member_id,'checkedAt',checked_at)order by checked_at desc,member_id),'[]')from checked)else null end
 into contexts,people,own_keys,private_rows;
 return jsonb_build_object('serverNow',at_time,'currentId',m.id,'contexts',contexts,'presence',people,'own',own_keys)||case when details then jsonb_build_object('entries',private_rows)else '{}'::jsonb end;
end;$$;

create function public.task_app_check_in(selected_category uuid,selected_date date,selected_service text default null,selected_meeting uuid default null,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;scope record;at_time timestamptz;a public.account_member_absences;ended_at timestamptz;
begin
 m:=public.task_app_require_role();
 if confirmed is distinct from true or selected_category is null or selected_date is null or(selected_service is not null and selected_service not in('morning','evening'))then raise exception 'Confirm your meeting check-in'using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||m.id::text||':'||selected_category::text,0));
 -- Same workspace lock as activation, role changes, marking absent and claiming tasks.
 -- Re-read server time and current scope after locks, never trust a client clock.
 at_time:=clock_timestamp();
 select * into scope from public.task_app_check_in_contexts(m.owner_id,at_time)c where c.category_id=selected_category and c.meeting_date=selected_date and c.service=coalesce(selected_service,'')and c.meeting_id is not distinct from selected_meeting;
 if scope.category_id is null then raise exception 'This meeting changed'using errcode='P0409';end if;
 if at_time<scope.opens_at or at_time>=scope.closes_at then raise exception 'Check-in is closed'using errcode='P0016';end if;
 for a in select * from public.account_member_absences x where x.owner_id=m.owner_id and x.member_id=m.id and x.category_id=selected_category and x.cancelled_at is null and x.created_at<=at_time and x.expires_at>at_time
 and x.restriction_role is null and(scope.category_name<>'Special Meeting'or x.meeting_date=selected_date)
 and(scope.category_name<>'Sunday Service'or public.task_app_absence_service_covers(x,selected_service,at_time))order by x.id for update loop
  perform 1 from public.task_fine_candidates where owner_id=m.owner_id and member_id=m.id and category_id=selected_category and not finalized order by task_id for update;
  ended_at:=greatest(at_time,a.created_at+interval '1 microsecond');
  if ended_at>=a.expires_at then continue;end if;
  if scope.category_name='Sunday Service'and a.sunday_service is null then
   update public.account_member_absences set morning_returned_at=case when selected_service='morning'then ended_at else morning_returned_at end,
    evening_returned_at=case when selected_service='evening'then ended_at else evening_returned_at end where id=a.id;
  else
   update public.account_member_absences set previous_expires_at=expires_at,expires_at=ended_at,cancelled_at=ended_at where id=a.id;
  end if;
 end loop;
 -- Absence clearing deliberately preserves task claims, restrictions, issued fines and first check-in time.
 at_time:=clock_timestamp();
 if at_time<scope.opens_at or at_time>=scope.closes_at then raise exception 'Check-in is closed'using errcode='P0016';end if;
 insert into public.task_member_check_ins(owner_id,member_id,category_id,meeting_date,service,meeting_id,checked_at)
 values(m.owner_id,m.id,selected_category,selected_date,coalesce(selected_service,''),selected_meeting,at_time)on conflict do nothing;
 return jsonb_build_object('state',public.task_app_check_in_state(false),'members',public.task_app_member_state());
end;$$;

revoke all on function public.task_app_check_in_contexts(uuid,timestamptz),public.task_app_check_in_state(boolean),public.task_app_check_in(uuid,date,text,uuid,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_check_in_state(boolean),public.task_app_check_in(uuid,date,text,uuid,boolean)to authenticated;
create trigger member_check_ins_sync after insert on public.task_member_check_ins for each row execute function public.task_app_notify_sync('members');
commit;
