def all_activity(user=owner):
 page=activity(user);rows=list(page['entries'])
 while page['hasMore']:
  last=page['entries'][-1];page=activity(user,before=last['createdAt'],before_id=last['id']);rows.extend(page['entries'])
 return rows

old_id='00000000-0000-4000-8000-000000008900'
recent_id='00000000-0000-4000-8000-000000008901'
sql(f"insert into public.task_activity_log(id,owner_id,kind,title,created_at)values('{old_id}','{owner}','task_created','Expired activity',statement_timestamp()-interval '169 hours'),('{recent_id}','{owner}','task_created','Recent activity',statement_timestamp()-interval '167 hours');")
check('Activity cleanup installs disabled',sql('select enabled_at is null from public.task_activity_retention_configuration;')=='t')
check('Disabled cleanup does not delete existing activity',sql('select public.task_app_purge_activity();')=='0'and sql(f"select count(*)from public.task_activity_log where id='{old_id}';")=='1')
check('Disabled retention does not hide existing records',old_id in{e['id']for e in all_activity()})
for role in ['anon','authenticated','service_role']:
 check(role+' cannot execute purge or enable retention',sql(f"select has_function_privilege('{role}','public.task_app_purge_activity()','execute')or has_table_privilege('{role}','public.task_activity_retention_configuration','update');")=='f')
sql("create schema cron;create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);create function cron.schedule(text,text,text)returns bigint language sql as $$insert into cron.job(jobname,schedule,command)values($1,$2,$3)returning jobid$$;insert into cron.job(jobname,schedule,command)values('existing-job','* * * * *','select 1');")
activation=(root/'supabase/operations/activate_activity_cleanup.sql').read_text()
sql('delete from public.task_activity_retention_configuration;')
expect('Activation refuses missing configuration',activation,None,'configuration is missing')
sql('insert into public.task_activity_retention_configuration(singleton)values(true);')
sql("insert into cron.job(jobname,schedule,command)values('bgm-task-activity-cleanup','* * * * *','select 2');")
expect('Activation refuses to overwrite an existing job',activation,None,'job already exists')
check('Failed activation preserves existing job and disabled state',sql("select command from cron.job where jobname='bgm-task-activity-cleanup';")=='select 2'and sql('select enabled_at is null from public.task_activity_retention_configuration;')=='t')
sql("delete from cron.job where jobname='bgm-task-activity-cleanup';")
sql(activation)
check('Separate activation creates only hourly Activity job',sql("select count(*)from cron.job where jobname='bgm-task-activity-cleanup'and schedule='0 * * * *'and command='select public.task_app_purge_activity();'and active;")=='1'and sql("select command from cron.job where jobname='existing-job';")=='select 1')
check('Activation itself does not purge',sql(f"select count(*)from public.task_activity_log where id='{old_id}';")=='1')
expect('Activation rejects replay',activation,None,'already active')
def source_snapshot():
 return sql("select md5(jsonb_build_object('tasks',(select jsonb_agg(to_jsonb(t)order by id)from public.tasks t),'members',(select jsonb_agg(to_jsonb(m)order by id)from public.account_members m),'fines',(select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f),'auth_count',(select count(*)from auth.users),'totals',(select jsonb_agg(to_jsonb(c)order by member_id,completion_year)from public.member_completion_totals c))::text);")
foreign_id='00000000-0000-4000-8000-000000008904'
sql(f"insert into public.task_activity_log(id,owner_id,kind,title)values('{foreign_id}','{outsider}','task_created','Foreign recent activity');")
before=source_snapshot()
page=activity()
check('All-time reads and totals omit expired activity before Cron',sql(f"select count(*)from public.task_activity_log where id='{old_id}';")=='1'and old_id not in{e['id']for e in all_activity()}and page['total']==int(sql(f"select count(*)from public.task_activity_log where owner_id='{owner}'and created_at>statement_timestamp()-interval '168 hours';")))
check('Retention read remains isolated to the current workspace',foreign_id not in{e['id']for e in all_activity()})
check('Recent activity still visible',recent_id in{e['id']for e in all_activity()})
check('Purge removes expired existing records',int(sql('select public.task_app_purge_activity();'))>=1 and sql(f"select count(*)from public.task_activity_log where id='{old_id}';")=='0')
check('Purge preserves young activity',sql(f"select count(*)from public.task_activity_log where id='{recent_id}';")=='1')
check('Source records and yearly totals are unchanged',source_snapshot()==before)
check('A repeat purge is a no-op',sql('select public.task_app_purge_activity();')=='0')
admin_as(f"""do $$begin
 insert into public.task_activity_log(id,owner_id,kind,created_at)values('00000000-0000-4000-8000-000000008902','{owner}','task_created',statement_timestamp()-interval '168 hours'),('00000000-0000-4000-8000-000000008903','{owner}','task_created',statement_timestamp()-interval '168 hours'+interval '1 second');
 assert not exists(select 1 from jsonb_array_elements(public.task_app_activity()->'entries')e where e->>'id'='00000000-0000-4000-8000-000000008902');
 perform public.task_app_purge_activity();
 assert not exists(select 1 from public.task_activity_log where id='00000000-0000-4000-8000-000000008902');
 assert exists(select 1 from public.task_activity_log where id='00000000-0000-4000-8000-000000008903');
end;$$;""",owner)
print('PASS exact 168-hour deletion boundary preserves one-second-younger records',flush=True)
expect('Member still cannot read retained activity','select public.task_app_activity();',member,'P0403')
check('Coordinator still reads retained activity',isinstance(activity(coord)['entries'],list))
check('Read-only retention checks have zero violations',all(line.endswith('|0')for line in sql((root/'supabase/verification/20261016_activity_retention_checks.sql').read_text()).splitlines()))
