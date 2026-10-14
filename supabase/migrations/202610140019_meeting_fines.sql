-- LOCAL REVIEW ONLY. Financial records are private; activation is a separate
-- admin-only step after deployment. No existing task or account rows change.
begin;
create table public.task_fine_configuration (
 singleton boolean primary key default true check(singleton), enabled_at timestamptz
);
insert into public.task_fine_configuration(singleton)values(true);
create table public.task_fine_candidates (
 owner_id uuid not null references public.task_workspaces(owner_id) on delete cascade,
 task_id uuid primary key, title text not null, category_id uuid, category_name text not null,
 member_id uuid, member_name text, scheduled_date date, due_at timestamptz, cutoff_at timestamptz,
 available_at timestamptz, completed boolean not null, deleted boolean not null,
 created_at timestamptz not null, finalized boolean not null default false
);
create index task_fine_pending on public.task_fine_candidates(cutoff_at)where not finalized;
create table public.task_fines (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.task_workspaces(owner_id) on delete cascade,
 task_id uuid not null unique, title text not null, category_name text not null,
 member_id uuid not null, member_name text not null, cutoff_at timestamptz not null,
 amount_paise integer not null default 5000 check(amount_paise=5000),
 status text not null default 'unpaid'check(status in('unpaid','paid','cancelled')),
 assessed_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 settled_at timestamptz, settled_by_id uuid, settled_by_name text, reason text,
 check((status='unpaid'and settled_at is null and settled_by_id is null and reason is null)
 or(status in('paid','cancelled')and settled_at is not null and settled_by_id is not null)),
 check(status<>'cancelled'or(reason is not null and length(btrim(reason))between 1 and 500))
);
create index task_fines_workspace on public.task_fines(owner_id,cutoff_at desc,id);
alter table public.task_fine_configuration enable row level security;
alter table public.task_fine_candidates enable row level security;
alter table public.task_fines enable row level security;
revoke all on public.task_fine_configuration,public.task_fine_candidates,public.task_fines from public,anon,authenticated,service_role;

-- Fine cutoffs are independent of existing due/category/history rules.
create function public.task_app_fine_cutoff(category_name text,scheduled_date date,due_time time)
returns timestamptz language plpgsql immutable set search_path='' as $$
declare target integer;day date;due_at timestamptz;result timestamptz;
begin
 if scheduled_date is null or scheduled_date>date '9999-12-22' then return null;end if;
 if category_name='Special Meeting'then return((scheduled_date+1)+time '05:00')at time zone 'Asia/Kolkata';end if;
 target:=case category_name when 'Sunday Service'then 1 when 'Healing Meeting'then 4 when 'Woman''s Meeting'then 5 when 'Revival Meeting'then 6 else null end;
 if target is null then return null;end if;
 day:=scheduled_date+((target-extract(dow from scheduled_date)::integer+7)%7);
 result:=(day+time '05:00')at time zone 'Asia/Kolkata';
 due_at:=case when due_time is null then(scheduled_date+1)::timestamp at time zone 'Asia/Kolkata'else(scheduled_date+due_time)at time zone 'Asia/Kolkata'end;
 if result<due_at then result:=result+interval '7 days';end if;
 return result;
end;$$;

-- Finalize authoritative pre-cutoff state before any later task mutation.
-- Candidate rows survive task deletion, and absence is evaluated historically.
create function public.task_app_finalize_fine(candidate_id uuid,at_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c public.task_fine_candidates;activation timestamptz;
begin
 select enabled_at into activation from public.task_fine_configuration where singleton;
 if activation is null then return;end if;
 select * into c from public.task_fine_candidates where task_id=candidate_id for update;
 if c.task_id is null or c.finalized or c.cutoff_at is null or c.cutoff_at>at_time then return;end if;
 if c.cutoff_at>activation and c.created_at<c.cutoff_at and not c.completed and not c.deleted
 and c.member_id is not null and c.due_at<=c.cutoff_at
 and(c.available_at is null or c.available_at<=c.cutoff_at)
 and not exists(select 1 from public.account_member_absences a
  where a.owner_id=c.owner_id and a.member_id=c.member_id and a.category_id=c.category_id
  and a.created_at<c.cutoff_at and a.expires_at>c.cutoff_at
  and(c.category_name<>'Special Meeting'or a.meeting_date=c.scheduled_date))then
  insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)
  values(c.owner_id,c.task_id,c.title,c.category_name,c.member_id,coalesce(c.member_name,'Former member'),c.cutoff_at)
  on conflict(task_id)do nothing;
 end if;
 update public.task_fine_candidates set finalized=true where task_id=c.task_id;
end;$$;

create function public.task_app_track_fine(t public.tasks)
returns void language plpgsql security definer set search_path='' as $$
declare category_name text;member_name text;activation timestamptz;due_at timestamptz;cutoff_at timestamptz;
begin
 select enabled_at into activation from public.task_fine_configuration where singleton;
 if activation is null then return;end if;
 select name into category_name from public.categories where owner_id=t.owner_id and id=t.category_id;
 select name into member_name from public.account_members where owner_id=t.owner_id and id=t.assigned_to_member_id;
 cutoff_at:=public.task_app_fine_cutoff(category_name,t.due_date,t.due_time);
 due_at:=case when t.due_date is null then null when t.due_time is null then(t.due_date+1)::timestamp at time zone 'Asia/Kolkata'else(t.due_date+t.due_time)at time zone 'Asia/Kolkata'end;
 insert into public.task_fine_candidates(owner_id,task_id,title,category_id,category_name,member_id,member_name,scheduled_date,due_at,cutoff_at,available_at,completed,deleted,created_at,finalized)
 values(t.owner_id,t.id,t.title,t.category_id,coalesce(category_name,''),t.assigned_to_member_id,member_name,t.due_date,due_at,cutoff_at,t.available_at,t.status='completed',t.deleted_at is not null,t.created_at,coalesce(cutoff_at<=greatest(activation,statement_timestamp()),false))
 on conflict(task_id)do update set title=excluded.title,category_id=excluded.category_id,category_name=excluded.category_name,
 member_id=excluded.member_id,member_name=excluded.member_name,scheduled_date=excluded.scheduled_date,due_at=excluded.due_at,cutoff_at=excluded.cutoff_at,
 available_at=excluded.available_at,completed=excluded.completed,deleted=excluded.deleted,finalized=excluded.finalized
 where not public.task_fine_candidates.finalized
 or(excluded.cutoff_at>statement_timestamp()and excluded.cutoff_at is distinct from public.task_fine_candidates.cutoff_at
 and not exists(select 1 from public.task_fines f where f.task_id=excluded.task_id));
end;$$;

create function public.task_app_fine_before_change()returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.task_app_finalize_fine(old.id,statement_timestamp());
 if tg_op='DELETE'then update public.task_fine_candidates set deleted=true where task_id=old.id and not finalized;return old;end if;return new;
end;$$;
create function public.task_app_fine_after_change()returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.task_app_track_fine(new);return new;end;$$;
create trigger tasks_fines_before before update or delete on public.tasks for each row execute function public.task_app_fine_before_change();
create trigger tasks_fines_after after insert or update on public.tasks for each row execute function public.task_app_fine_after_change();

-- Called only by cron/admin or by the role-checked workspace read below.
create function public.task_app_assess_fines(own uuid,at_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c record;
begin
 for c in select task_id from public.task_fine_candidates where owner_id=own and not finalized and cutoff_at<=at_time order by task_id for update skip locked loop
  perform public.task_app_finalize_fine(c.task_id,at_time);
 end loop;
end;$$;
create function public.task_app_assess_scheduled_fines()returns void language plpgsql security definer set search_path='' as $$
declare own uuid;
begin
 for own in select distinct owner_id from public.task_fine_candidates where not finalized and cutoff_at<=statement_timestamp()loop
  perform public.task_app_assess_fines(own,statement_timestamp());
 end loop;
end;$$;

-- Apply only at the approved rollout/activation time. Idempotent: never reset it.
create function public.task_app_enable_fines()returns timestamptz language plpgsql security definer set search_path='' as $$
declare activated timestamptz;t public.tasks;
begin
 select enabled_at into activated from public.task_fine_configuration where singleton for update;
 if activated is not null then return activated;end if;
 lock table public.tasks in share row exclusive mode;
 activated:=clock_timestamp();update public.task_fine_configuration set enabled_at=activated where singleton;
 for t in select * from public.tasks order by id loop perform public.task_app_track_fine(t);end loop;
 return activated;
end;$$;
create function public.task_app_fines()returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;
begin
 m:=public.task_app_require_role(true);
 perform public.task_app_assess_fines(m.owner_id,statement_timestamp());
 return jsonb_build_object('serverNow',statement_timestamp(),'enabledAt',(select enabled_at from public.task_fine_configuration where singleton),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)order by name,id)from public.account_members where owner_id=m.owner_id),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'taskId',f.task_id,'title',f.title,'category',f.category_name,
 'memberId',f.member_id,'memberName',coalesce(n.name,f.member_name),'cutoffAt',f.cutoff_at,'amountPaise',f.amount_paise,'status',f.status,
 'assessedAt',f.assessed_at,'version',f.updated_at,'settledAt',f.settled_at,'settledById',f.settled_by_id,'settledByName',coalesce(actor.name,f.settled_by_name),'reason',f.reason)order by f.cutoff_at desc,f.id)
 from public.task_fines f left join public.account_members n on n.id=f.member_id and n.owner_id=f.owner_id
 left join public.account_members actor on actor.id=f.settled_by_id and actor.owner_id=f.owner_id where f.owner_id=m.owner_id),'[]'::jsonb));
end;$$;
create function public.task_app_settle_fine(fine_id uuid,expected_version timestamptz,operation text,cancel_reason text default null,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;f public.task_fines;
begin
 m:=public.task_app_require_role(true);
 if confirmed is distinct from true or operation not in('paid','cancelled')or operation is null
 or(operation='cancelled'and(cancel_reason is null or length(btrim(cancel_reason))not between 1 and 500))
 or(operation='paid'and cancel_reason is not null)then raise exception 'Confirm the fine action and provide a cancellation reason'using errcode='23514';end if;
 select * into f from public.task_fines where id=fine_id and owner_id=m.owner_id for update;
 if f.id is null or f.status<>'unpaid'or f.updated_at is distinct from expected_version then raise exception 'Fine changed; refresh before continuing'using errcode='P0409';end if;
 update public.task_fines set status=operation,settled_at=statement_timestamp(),settled_by_id=m.id,settled_by_name=m.name,
 reason=case when operation='cancelled'then btrim(cancel_reason)else null end,updated_at=clock_timestamp()where id=f.id;
 return jsonb_build_object('id',f.id,'status',operation,'data',public.task_app_fines());
end;$$;
create trigger fines_live_sync after insert or update on public.task_fines for each row execute function public.task_app_notify_sync('tasks');
revoke all on function public.task_app_fine_cutoff(text,date,time),public.task_app_finalize_fine(uuid,timestamptz),public.task_app_track_fine(public.tasks),
 public.task_app_fine_before_change(),public.task_app_fine_after_change(),public.task_app_assess_fines(uuid,timestamptz),public.task_app_assess_scheduled_fines(),
 public.task_app_enable_fines(),public.task_app_fines(),public.task_app_settle_fine(uuid,timestamptz,text,text,boolean)from public,anon,authenticated,service_role;
grant execute on function public.task_app_fines(),public.task_app_settle_fine(uuid,timestamptz,text,text,boolean)to authenticated;
notify pgrst,'reload schema';
commit;
