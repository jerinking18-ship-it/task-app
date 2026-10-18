-- Read-only after040. Expected zero rows; never installs or changes anything.
select 'missing_validated_category_guard' as issue where not exists(
 select 1 from pg_constraint where conrelid='public.categories'::regclass
 and conname='task_app_meeting_categories_only' and contype='c' and convalidated)
union all select 'unsupported_category_exists' where exists(
 select 1 from public.categories where name not in('Sunday Service','Healing Meeting','Revival Meeting','Special Meeting'));
