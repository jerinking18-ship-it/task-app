-- Local review only: one shared display title, no task/category renaming.
begin;
do $$begin
 if to_regclass('public.task_meeting_settings') is not null then raise exception 'Meeting title is already installed; do not replay';end if;
 if to_regprocedure('public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)') is null then raise exception 'Install reviewed migrations through 032 first';end if;
end;$$;
create table public.task_meeting_settings(
 owner_id uuid primary key references public.task_workspaces(owner_id) on delete cascade,
 title text,
 updated_at timestamptz not null default clock_timestamp(),
 check(title is null or(title=btrim(title)and length(title)between 1 and 60 and title!~'[[:cntrl:]]'and position(chr(8232)in title)=0 and position(chr(8233)in title)=0))
);
alter table public.task_meeting_settings enable row level security;
revoke all on public.task_meeting_settings from public,anon,authenticated,service_role;
create function public.task_app_special_meeting_title()returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;s public.task_meeting_settings;
begin
 m:=public.task_app_require_role(false);
 select * into s from public.task_meeting_settings where owner_id=m.owner_id;
 return jsonb_build_object('title',s.title,'version',s.updated_at);
end;$$;
create function public.task_app_set_special_meeting_title(meeting_title text,expected_version timestamptz default null)
returns jsonb language plpgsql security definer set search_path=''as $$
declare m public.account_members;s public.task_meeting_settings;normalized text;at_time timestamptz;
begin
 m:=public.task_app_require_role(true);
 if meeting_title is null or meeting_title~'[[:cntrl:]]'or position(chr(8232)in meeting_title)>0 or position(chr(8233)in meeting_title)>0
 or length(btrim(meeting_title))>60 or(expected_version is not null and not isfinite(expected_version))then raise exception 'Invalid meeting title'using errcode='23514';end if;
 normalized:=nullif(btrim(meeting_title),'');
 perform pg_advisory_xact_lock(hashtextextended(m.owner_id::text,334));
 select * into s from public.task_meeting_settings where owner_id=m.owner_id for update;
 if s.updated_at is distinct from expected_version then return jsonb_build_object('conflict',true,'latest',jsonb_build_object('title',s.title,'version',s.updated_at));end if;
 at_time:=greatest(clock_timestamp(),s.updated_at+interval '1 microsecond');
 insert into public.task_meeting_settings(owner_id,title,updated_at)values(m.owner_id,normalized,at_time)
 on conflict(owner_id)do update set title=excluded.title,updated_at=excluded.updated_at;
 return jsonb_build_object('title',normalized,'version',at_time);
end;$$;
create trigger special_meeting_title_sync after insert or update on public.task_meeting_settings
 for each row execute function public.task_app_notify_sync('tasks');
revoke all on function public.task_app_special_meeting_title(),public.task_app_set_special_meeting_title(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.task_app_special_meeting_title(),public.task_app_set_special_meeting_title(text,timestamptz) to authenticated;
commit;
