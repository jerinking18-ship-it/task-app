-- Read only AFTER migration033. All violations must be zero.
select 'meeting_settings_rls',count(*)from pg_class where oid='public.task_meeting_settings'::regclass and not relrowsecurity;
select 'meeting_settings_private',count(*)from(values('anon'),('authenticated'),('service_role'))r(role_name)
 where has_table_privilege(r.role_name,'public.task_meeting_settings','select,insert,update,delete');
select 'meeting_rpc_grants',count(*)from(values('anon'),('service_role'))r(role_name)
 where has_function_privilege(r.role_name,'public.task_app_special_meeting_title()','execute')or has_function_privilege(r.role_name,'public.task_app_set_special_meeting_title(text,timestamptz)','execute');
select 'meeting_rpc_permissions',case when
 has_function_privilege('authenticated','public.task_app_special_meeting_title()','execute')and has_function_privilege('authenticated','public.task_app_set_special_meeting_title(text,timestamptz)','execute')
 and position('task_app_require_role(false)'in pg_get_functiondef('public.task_app_special_meeting_title()'::regprocedure))>0
 and position('task_app_require_role(true)'in pg_get_functiondef('public.task_app_set_special_meeting_title(text,timestamptz)'::regprocedure))>0 then 0 else 1 end;
select 'meeting_rpc_paths',count(*)from pg_proc where oid in('public.task_app_special_meeting_title()'::regprocedure,'public.task_app_set_special_meeting_title(text,timestamptz)'::regprocedure)
 and(not prosecdef or proconfig is distinct from array['search_path=""']);
select 'meeting_title_sync',case when exists(select 1 from pg_trigger where tgrelid='public.task_meeting_settings'::regclass and tgname='special_meeting_title_sync'and not tgisinternal)then 0 else 1 end;
