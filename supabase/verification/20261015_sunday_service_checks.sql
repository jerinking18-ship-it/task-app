-- Read-only after NEW026. All counters must be zero; never replays migrations.
select 'sunday_task_metadata',count(*)from public.tasks t left join public.categories c on c.owner_id=t.owner_id and c.id=t.category_id
where(case when c.name='Sunday Service'then t.sunday_service in('morning','evening')else t.sunday_service is null end)is not true
union all
select 'sunday_pending_metadata',count(*)from public.task_repeat_pending p join public.categories c on c.owner_id=p.owner_id and c.id::text=p.payload->>'category_id'
where(case when c.name='Sunday Service'then p.payload->>'sunday_service'in('morning','evening')else p.payload->>'sunday_service'is null end)is not true
union all
select 'sunday_helper_access',count(*)from pg_proc where oid='public.task_app_validate_sunday_service()'::regprocedure
and(not prosecdef or not coalesce(proconfig,'{}')@>array['search_path=""']or has_function_privilege('anon',oid,'execute')or has_function_privilege('authenticated',oid,'execute')or has_function_privilege('service_role',oid,'execute'))
union all
select 'sunday_trigger',case when exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_sunday_service'and tgenabled='O')then 0 else 1 end;
