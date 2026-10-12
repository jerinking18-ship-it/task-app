-- PREPARED LOCALLY ONLY. Apply once after explicit approval; no live data is changed here.
-- Adds optional weekday labels and retained-record task deletion, preserving owner RLS.
begin;

create function public.task_app_valid_weekdays(value smallint[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select coalesce(array_ndims(value), 1) = 1
    and cardinality(value) <= 7
    and value <@ array[0,1,2,3,4,5,6]::smallint[]
    and cardinality(value) = (select count(distinct day) from unnest(value) as days(day));
$$;

revoke all on function public.task_app_valid_weekdays(smallint[]) from public, anon, authenticated;
grant execute on function public.task_app_valid_weekdays(smallint[]) to authenticated;

alter table public.tasks
  add column weekdays smallint[] not null default '{}'::smallint[],
  add column deleted_at timestamptz,
  add constraint tasks_weekdays_valid check (public.task_app_valid_weekdays(weekdays));

-- Existing table RLS still independently checks auth.uid() against owner_id.
grant insert (weekdays) on public.tasks to authenticated;
grant update (weekdays, deleted_at) on public.tasks to authenticated;
-- Hard task DELETE remains unavailable.
create index tasks_owner_visible_idx on public.tasks (owner_id, id) where deleted_at is null;

-- Approved legacy-category transition. Keep every task and its details/status,
-- move only the three former presets to Uncategorized, then remove those names.
-- Other custom categories are unaffected. This runs in the same transaction.
update public.tasks as task
set category_id = null
from public.categories as category
where task.category_id = category.id and task.owner_id = category.owner_id
  and lower(category.name) in ('personal', 'work', 'shopping');
delete from public.categories where lower(name) in ('personal', 'work', 'shopping');
notify pgrst, 'reload schema';
commit;
