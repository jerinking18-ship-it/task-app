-- DISPOSABLE PostgreSQL ONLY. Never run against Supabase.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000801'),('00000000-0000-4000-8000-000000000802');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000801'),('00000000-0000-4000-8000-000000000812','00000000-0000-4000-8000-000000000802');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000801';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000811';
set role authenticated;
select public.task_app_choose_member(null,'Live Example')->'current'->>'name';
do $$ declare s jsonb;before_seen text;begin
 s:=public.task_app_member_state();assert s->>'server_now' is not null;assert s->'current'->>'active_until' is null;
 before_seen:=s->'current'->>'last_seen_at';perform public.task_app_member_state();assert public.task_app_member_state()->'current'->>'last_seen_at'=before_seen;
 s:=public.task_app_presence('00000000-0000-4000-8000-000000000821',true,1);
 assert (s->'current'->>'active_until')::timestamptz=statement_timestamp()+interval '65 seconds';
 s:=public.task_app_presence('00000000-0000-4000-8000-000000000822',true,1);
 s:=public.task_app_presence('00000000-0000-4000-8000-000000000821',false,3);assert s->'current'->>'active_until' is not null;
 -- An older delayed active request cannot resurrect the closed first tab.
 perform public.task_app_presence('00000000-0000-4000-8000-000000000821',true,2);
 s:=public.task_app_presence('00000000-0000-4000-8000-000000000822',false,2);assert s->'current'->>'active_until' is null;
 begin perform public.task_app_presence('00000000-0000-4000-8000-000000000822',true,0);raise exception 'Expected invalid sequence';exception when check_violation then null;end;
 begin select * from public.account_member_presence;raise exception 'Expected no direct presence read';exception when insufficient_privilege then null;end;
end $$;
insert into public.tasks(title) values('Live sync private task');
set realtime.topic='task-account:00000000-0000-4000-8000-000000000801';
do $$ begin
 assert exists(select 1 from realtime.messages where payload='{"scope":"tasks"}'::jsonb and private);
 assert not exists(select 1 from realtime.messages where topic<>'task-account:00000000-0000-4000-8000-000000000801');
end $$;
reset role;
-- Lease expiry removes Active without any new browser request or forged clock.
update public.account_member_presence set active_until=statement_timestamp()-interval '1 second';
update public.account_members set last_seen_at=statement_timestamp()-interval '1 hour' where owner_id='00000000-0000-4000-8000-000000000801';
set role authenticated;
do $$ declare before_seen timestamptz;begin
 select last_seen_at into before_seen from public.account_members where owner_id='00000000-0000-4000-8000-000000000801';
 assert public.task_app_member_state()->'current'->>'active_until' is null;
 assert (public.task_app_member_state()->'current'->>'last_seen_at')::timestamptz=before_seen;
end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000802';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000812';
select public.task_app_choose_member(null,'Other Live Example')->'current'->>'name';
set realtime.topic='task-account:00000000-0000-4000-8000-000000000801';
do $$ begin assert not exists(select 1 from realtime.messages);end $$;
select public.task_app_leave_member();
do $$ begin begin perform public.task_app_presence('00000000-0000-4000-8000-000000000823',true,1);raise exception 'Expected revoked member denied';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$ begin
 assert not exists(select 1 from realtime.messages where payload ? 'title' or payload ? 'notes' or payload ? 'name');
 assert not exists(select 1 from realtime.messages where not private);
 assert exists(select 1 from public.tasks where title='Live sync private task');
end $$;
set role anon;
do $$ begin begin perform public.task_app_presence('00000000-0000-4000-8000-000000000823',true,1);raise exception 'Expected anon denied';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'Live sync private notifications, owner isolation, heartbeat ordering, multi-tab and expiry checks passed';
