-- Read-only post-install checks for036. Never install/replay migrations here.
select 'all event tables have RLS' as check_name,bool_and(c.relrowsecurity) as passed
from pg_class c where c.oid in('public.task_special_meetings'::regclass,'public.task_special_plans'::regclass,'public.task_special_activations'::regclass);
select 'new tables have no direct API access' as check_name,not exists(
 select 1 from(values('anon'),('authenticated'),('service_role'))r(role)
 cross join(values('public.task_special_meetings'),('public.task_special_plans'),('public.task_special_activations'))t(name)
 where has_table_privilege(r.role,t.name,'select,insert,update,delete'))as passed;
select 'Special cutoff disabled' as check_name,public.task_app_fine_cutoff('Special Meeting',date '2026-10-21',time '23:50')is null as passed;
select 'bounded occurrences unique' as check_name,not exists(select 1 from public.tasks where special_plan_id is not null group by special_plan_id,due_date having count(*)>1)as passed;
select 'no overlapping unlocked schedules' as check_name,not exists(select 1 from public.task_special_meetings a join public.task_special_meetings b on a.owner_id=b.owner_id and a.id<b.id where not a.locked and not b.locked and(a.start_date::timestamp at time zone 'Asia/Kolkata')<public.task_app_special_end(b)and(b.start_date::timestamp at time zone 'Asia/Kolkata')<public.task_app_special_end(a))as passed;
select 'all Special rows adopted' as check_name,not exists(select 1 from public.tasks t join public.categories c on c.id=t.category_id and c.owner_id=t.owner_id where c.name='Special Meeting'and t.special_plan_id is null)as passed;
select 'private helpers inaccessible' as check_name,bool_and(not has_function_privilege(r.role,p.oid,'execute'))as passed from pg_proc p cross join(values('anon'),('authenticated'),('service_role'))r(role)where p.pronamespace='public'::regnamespace and p.proname in('task_app_prepare_special','task_app_release_special','task_app_before_special_mutate','task_app_mutate_special','task_app_special_active','task_app_special_replaced','task_app_special_record_release');
