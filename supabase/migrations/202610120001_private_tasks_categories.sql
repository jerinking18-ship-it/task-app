-- Prepared and applied to task-app on 2026-10-12 via the Supabase SQL Editor.
-- Application and verification record: plans/08-database-plan.md.
-- First schema only: no sample data, sign-in UI, reminders, or recurrence.
-- Run once after approval. Existing objects cause an error and full rollback.
begin;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  constraint categories_name_valid check (
    char_length(name) between 1 and 40
    and name = btrim(name)
    and name ~ '[^[:space:]]'
  ),
  constraint categories_owner_id_id_key unique (owner_id, id)
);

-- Names are unique per account, using PostgreSQL's lower-case comparison.
create unique index categories_owner_name_key
  on public.categories (owner_id, lower(name));

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete restrict,
  title text not null,
  notes text,
  status text not null default 'active',
  due_date date,
  due_time time without time zone,
  priority text not null default 'none',
  category_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tasks_title_valid check (
    char_length(title) between 1 and 200
    and title = btrim(title)
    and title ~ '[^[:space:]]'
  ),
  constraint tasks_notes_length check (char_length(notes) <= 4000),
  constraint tasks_status_valid check (status in ('active', 'completed')),
  constraint tasks_priority_valid check (priority in ('none', 'low', 'medium', 'high')),
  constraint tasks_due_time_requires_date check (due_time is null or due_date is not null),
  constraint tasks_completion_consistent check (
    (status = 'active' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  ),
  -- Nullable category_id permits no category. A non-null ID must share owner_id.
  constraint tasks_owned_category_fkey foreign key (owner_id, category_id)
    references public.categories (owner_id, id) on delete restrict
);

create index tasks_owner_created_idx on public.tasks (owner_id, created_at desc, id);
create index tasks_owner_status_due_idx on public.tasks (owner_id, status, due_date);
create index tasks_owner_category_idx on public.tasks (owner_id, category_id);

-- Server-managed timestamps; no privileged execution or queries to other tables.
create function public.task_app_set_task_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  new.updated_at := statement_timestamp();

  if tg_op = 'INSERT' then
    new.created_at := new.updated_at;
    if new.status = 'completed' then
      new.completed_at := new.updated_at;
    else
      new.completed_at := null;
    end if;
  else
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Task identity, owner, and creation time cannot be changed'
        using errcode = '23514';
    end if;

    if new.status = 'active' then
      new.completed_at := null;
    elsif old.status is distinct from 'completed' then
      new.completed_at := new.updated_at;
    else
      new.completed_at := old.completed_at;
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_set_metadata
  before insert or update on public.tasks
  for each row execute function public.task_app_set_task_metadata();

create function public.task_app_trim_category_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  return new;
end;
$$;

create trigger categories_trim_name
  before insert on public.categories
  for each row execute function public.task_app_trim_category_name();

alter table public.categories enable row level security;
alter table public.tasks enable row level security;

-- Reset automatic grants before granting only the operations this stage uses.
revoke all privileges on table public.categories, public.tasks
  from public, anon, authenticated;
revoke all privileges on function public.task_app_set_task_metadata()
  from public, anon, authenticated;
revoke all privileges on function public.task_app_trim_category_name()
  from public, anon, authenticated;

grant select on table public.categories, public.tasks to authenticated;
grant insert (name) on public.categories to authenticated;
grant insert (title, notes, status, due_date, due_time, priority, category_id)
  on public.tasks to authenticated;
grant update (title, notes, status, due_date, due_time, priority, category_id)
  on public.tasks to authenticated;

-- owner_id defaults to the verified session's auth.uid(); clients cannot supply
-- or change it. RLS also checks ownership independently of column privileges.
create policy categories_select_own on public.categories
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy categories_insert_own on public.categories
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy tasks_select_own on public.tasks
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy tasks_insert_own on public.tasks
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy tasks_update_own on public.tasks
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- No DELETE policies or grants, category UPDATE access, or anonymous access.
-- Account deletion is intentionally blocked by owner FKs until retention is planned.
notify pgrst, 'reload schema';
commit;
