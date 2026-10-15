# Loaded inside the credential-free disposable workspace runner.
rpc('task_app_setup',"'bootstrap',null",owner)
category=sql(f"select id from public.categories where owner_id='{owner}'and name='Sunday Service';")
healing=sql(f"select id from public.categories where owner_id='{owner}'and name='Healing Meeting';")
today=sql("select(statement_timestamp()at time zone 'Asia/Kolkata')::date;")
fields={'title':'Sunday preparation','notes':'Keep notes','status':'active','due_date':today,'due_time':'23:50','priority':'medium','category_id':category,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
old=rpc('task_app_create_tasks',literal([fields]),owner)[0]
other=rpc('task_app_create_tasks',literal([{**fields,'category_id':healing}]),owner)[0]
def mutate(task,f,user=owner,scope='this'):
 series_version=sql(f"select max(updated_at)from public.tasks where owner_id='{owner}'and deleted_at is null and(series_id=(select series_id from public.tasks where id='{task['id']}')or id='{task['id']}');")if scope=='future'else task['updated_at']
 return rpc('task_app_mutate',f"'{task['id']}','{task['updated_at']}','update',{literal(f)},null,'{scope}','{series_version}'",user)
def read_task(task):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{task['id']}';"))
legacy_repeat={**fields,'due_date':sql("select((statement_timestamp()at time zone 'Asia/Kolkata')::date+1);"),'repeat_rule':'daily'}
legacy_sunday=rpc('task_app_create_tasks',literal([legacy_repeat]),owner)[0]
legacy_healing=rpc('task_app_create_tasks',literal([{**legacy_repeat,'category_id':healing}]),owner)[0]
for legacy in [legacy_sunday,legacy_healing]:rpc('task_app_mutate',f"'{legacy['id']}','{legacy['updated_at']}','status',null,'completed','this',null",member)
pending_before=sql("select md5(string_agg(to_jsonb(p)::text,'|'order by id))from public.task_repeat_pending p;")
before=sql("select md5(string_agg(to_jsonb(t)::text,'|'order by id))from public.tasks t;")
fines=sql('select count(*)from public.task_fines;')
sql((root/'supabase/migrations/202610150026_sunday_service_subcategories.sql').read_text())
check('026 metadata backfill preserves old task values',before==sql("select md5(string_agg((to_jsonb(t)-'sunday_service')::text,'|'order by id))from public.tasks t;"))
check('all existing Sunday tasks become Evening',read_task(old)['sunday_service']=='evening')
check('old Sunday queue becomes Evening',sql(f"select payload->>'sunday_service'from public.task_repeat_pending where source_task_id='{legacy_sunday['id']}';")=='evening')
check('other queue is unchanged',sql(f"select payload ? 'sunday_service'from public.task_repeat_pending where source_task_id='{legacy_healing['id']}';")=='f')
check('other category remains without subcategory',read_task(other)['sunday_service']is None)
check('backfill does not issue fines',fines==sql('select count(*)from public.task_fines;'))
expect('direct Sunday update denied',f"update public.tasks set sunday_service='morning'where id='{old['id']}';",member,'42501')
expect('normal Member cannot create Sunday',f"select public.task_app_create_tasks({literal([{**fields,'sunday_service':'morning'}])});",member,'P0403')
expect('helper has no executable access','select public.task_app_validate_sunday_service();',owner,'42501')
a,b=rpc('task_app_create_tasks',literal([{**fields,'sunday_service':'morning'},{**fields,'sunday_service':'evening'}]),coord)
check('mixed service batch saves separate values',a['sunday_service']=='morning'and b['sunday_service']=='evening')
expect('invalid service rejected',f"select public.task_app_create_tasks({literal([{**fields,'sunday_service':'night'}])});",owner,'23514')
expect('non-Sunday service rejected',f"select public.task_app_create_tasks({literal([{**fields,'category_id':healing,'sunday_service':'morning'}])});",owner,'23514')
a=mutate(a,{**fields,'sunday_service':'evening'},coord)
check('Coordinator can edit service',a['sunday_service']=='evening')
a=mutate(a,{**fields,'sunday_service':'morning'})
a=mutate(a,fields)
check('old-client update preserves Morning',a['sunday_service']=='morning')
conflict=mutate({**a,'updated_at':'2000-01-01T00:00:00Z'},{**fields,'sunday_service':'evening'})
check('stale edit cannot overwrite service',conflict.get('conflict')is True and read_task(a)['sunday_service']=='morning')
a=mutate(a,{**fields,'category_id':healing})
check('changing category clears service',a['sunday_service']is None)
a=mutate(a,{**fields,'sunday_service':'morning'})
# Repeat uses tomorrow's due date; completing queues an actual future payload.
repeat_fields={**fields,'due_date':sql("select((statement_timestamp()at time zone 'Asia/Kolkata')::date+1);"),'repeat_rule':'daily','sunday_service':'morning'}
r=rpc('task_app_create_tasks',literal([repeat_fields]),owner)[0]
r=rpc('task_app_mutate',f"'{r['id']}','{r['updated_at']}','status',null,'completed','this',null",member)
check('completion queues Morning metadata',sql(f"select payload->>'sunday_service'from public.task_repeat_pending where source_task_id='{r['id']}';")=='morning')
r=mutate(r,{**repeat_fields,'status':'completed','sunday_service':'evening'},scope='this')
check('this-only edit leaves queued service unchanged',sql(f"select payload->>'sunday_service'from public.task_repeat_pending where source_task_id='{r['id']}';")=='morning')
r=mutate(r,{**repeat_fields,'status':'completed','sunday_service':'evening'},scope='future')
check('future edit updates queued service',sql(f"select payload->>'sunday_service'from public.task_repeat_pending where source_task_id='{r['id']}';")=='evening')
queue=json.loads(sql(f"select to_jsonb(p)from public.task_repeat_pending p where source_task_id='{r['id']}';"))
sql(f"select public.task_app_release_repeats('{owner}',('{queue['due_date']}'::date+1)::timestamp at time zone 'Asia/Kolkata');")
child=read_task({'id':queue['id']})
check('released occurrence inherits Evening',child['sunday_service']=='evening'and child['assigned_to_member_id']==mm)
r=read_task(r)
r=mutate(r,{**repeat_fields,'status':'completed','category_id':healing,'sunday_service':None},scope='future')
check('future category change clears later task metadata',read_task(child)['sunday_service']is None)
# Bin keeps the saved service, and restore does not erase it.
deleted=rpc('task_app_mutate',f"'{a['id']}','{a['updated_at']}','delete',null,null,'this',null",owner)
a=read_task(a)
check('Bin preserves Morning',a['sunday_service']=='morning'and a['deleted_at']is not None)
rpc('task_app_bin',"'restore',"+literal([{'id':a['id'],'version':a['updated_at']}])+',true',owner)
check('restore preserves Morning',read_task(a)['sunday_service']=='morning')
# Every original trigger mode/grant was already asserted inside026.
checks=sql((root/'supabase/verification/20261015_sunday_service_checks.sql').read_text())
check('read-only postchecks all zero',all(line.endswith('|0')for line in checks.splitlines()))
expect('026 refuses accidental replay',(root/'supabase/migrations/202610150026_sunday_service_subcategories.sql').read_text(),None,'42701')
