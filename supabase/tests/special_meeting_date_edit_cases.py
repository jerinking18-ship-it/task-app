# Runs after the complete036 suite, entirely in its disposable database.
all_tasks_before=sql("select md5(jsonb_agg(to_jsonb(t)order by id)::text)from public.tasks t;")
credits_before=sql("select md5(coalesce(jsonb_agg(to_jsonb(t)order by member_id)::text,''))from public.member_completion_totals t;")
auth_before=sql("select md5(jsonb_agg(to_jsonb(t)order by id)::text)from auth.users t;")
sql((root/'supabase/migrations/202610160037_special_meeting_date_edit.sql').read_text())
check('037 installation preserves all tasks, completion totals and accounts',all_tasks_before==sql("select md5(jsonb_agg(to_jsonb(t)order by id)::text)from public.tasks t;")and credits_before==sql("select md5(coalesce(jsonb_agg(to_jsonb(t)order by member_id)::text,''))from public.member_completion_totals t;")and auth_before==sql("select md5(jsonb_agg(to_jsonb(t)order by id)::text)from auth.users t;"))
check('activation snapshots backfilled without changing interval bounds',sql("select bool_and(scheduled_start<scheduled_end)from public.task_special_activations;")=='t')
# Use the existing three-day event, including multiple plans/materialized days.
fresh=rpc('task_app_create_tasks',literal([{**fields,'title':'Shared date move fixture'}]),owner)[0]
se=event_for(fresh)
rpc('task_app_set_special_locked',f"'{se['id']}','{se['version']}',false,true",owner)
fresh=json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{fresh['id']}';"))
completed=rpc('task_app_mutate',f"'{fresh['id']}','{fresh['updated_at']}','status',null,'completed'",member)
sql(f"select public.task_app_release_special('{owner}','{nextday}T00:00:00+05:30');")
se=event_for(fresh)
rows_before=json.loads(sql(f"select jsonb_agg(to_jsonb(t)order by t.id)from public.tasks t join public.task_special_plans p on p.id=t.special_plan_id where p.meeting_id='{se['id']}';"))
ledger_before=json.loads(sql(f"select jsonb_agg(jsonb_build_object('id',id,'released',released_dates,'cancelled',cancelled,'payload',payload)order by id)from public.task_special_plans where meeting_id='{se['id']}';"))
activation_before=sql(f"select md5(jsonb_agg(jsonb_build_object('id',id,'s',scheduled_start,'e',scheduled_end)order by id)::text)from public.task_special_activations where meeting_id='{se['id']}';")
credits_before=sql("select md5(coalesce(jsonb_agg(to_jsonb(t)order by member_id)::text,''))from public.member_completion_totals t;")
completed['updated_at']=sql(f"select updated_at from public.tasks where id='{fresh['id']}';")
move_to=nextday # one-day overlap exercises deferred uniqueness with adjacent rows.
request=f"'{fresh['id']}','{completed['updated_at']}','update',{literal({**fields,'title':fresh['title'],'status':'completed'})},null,'this','{completed['series_version']}','{move_to}','{se['version']}',true,false"
sql('select public.task_app_reschedule_special_task('+request+');',member,fail='P0403')
sql('select public.task_app_reschedule_special_task('+request+');',outsider) # returnsnull, cannot reach another workspace.
check('cross-workspace attempt preserves shared meeting',event_for(fresh)['startDate']==day)
sql('select public.task_app_reschedule_special_task('+request.replace(',true,false',',false,false')+');',owner,fail='23514')
stale=rpc('task_app_reschedule_special_task',request.replace(se['version'],'2000-01-01T00:00:00Z'),owner)
check('stale meeting version rejects the whole operation',stale.get('conflict')is True and event_for(fresh)['startDate']==day)
result=rpc('task_app_reschedule_special_task',request,coord)
moved=event_for(fresh)
check('Coordinator moves the entire event and automatically relocks it',moved['startDate']==move_to and moved['locked']and result['due_date']==move_to and moved['version']!=se['version'])
check('moving event immediately restores normal views',sql(f"select public.task_app_special_active('{owner}',clock_timestamp())is null;")=='t')
rows_after=json.loads(sql(f"select jsonb_agg(to_jsonb(t)order by t.id)from public.tasks t join public.task_special_plans p on p.id=t.special_plan_id where p.meeting_id='{se['id']}';"))
from datetime import date as Date,timedelta
shift=lambda d:(Date.fromisoformat(d)+timedelta(days=1)).isoformat()
check('all daily task rows move together with progress, Bin and attribution preserved',len(rows_before)==len(rows_after)and all(b['id']==a['id']and a['due_date']==shift(b['due_date']or day)and {k:v for k,v in a.items()if k not in ['due_date','updated_at']}=={k:v for k,v in b.items()if k not in ['due_date','updated_at']}for b,a in zip(rows_before,rows_after)))
ledger_after=json.loads(sql(f"select jsonb_agg(jsonb_build_object('id',id,'released',released_dates,'cancelled',cancelled,'payload',payload)order by id)from public.task_special_plans where meeting_id='{se['id']}';"))
check('all future payload dates and release ledgers shift once',all(a['id']==b['id']and a['released']==[shift(d)for d in b['released']]and a['cancelled']==b['cancelled']and a['payload']['due_date']==shift(b['payload'].get('due_date')or day)for b,a in zip(ledger_before,ledger_after)))
check('completion time, History and yearly totals are preserved',credits_before==sql("select md5(coalesce(jsonb_agg(to_jsonb(t)order by member_id)::text,''))from public.member_completion_totals t;"))
check('historical activation date snapshots never move',activation_before==sql(f"select md5(jsonb_agg(jsonb_build_object('id',id,'s',scheduled_start,'e',scheduled_end)order by id)::text)from public.task_special_activations where meeting_id='{se['id']}';"))
check('old regular replacement exemptions survive a schedule move',sql(f"select public.task_app_special_replaced('{owner}','{regular_name}','{regular_day}','{cutoff}');")=='t')
stale=rpc('task_app_reschedule_special_task',request,owner)
check('retrying stale task version cannot move twice',stale.get('conflict')is True and event_for(fresh)['startDate']==move_to)
# Reactivation snapshots capture the new schedule and never reuse old dates.
rpc('task_app_set_special_locked',f"'{moved['id']}','{moved['version']}',false,true",owner)
check('reactivation records the new date bounds',sql(f"select scheduled_start=('{move_to}'::date::timestamp at time zone 'Asia/Kolkata')and scheduled_end=public.task_app_special_end(e)from public.task_special_activations a join public.task_special_meetings e on e.id=a.meeting_id where a.meeting_id='{moved['id']}'and a.closed_at is null;")=='t')
# Duplicate target schedule must be rejected without any partial task edit.
collision=sql(f"select date '{day}'+25;")
c=rpc('task_app_create_tasks',literal([{**fields,'title':'Collision schedule','due_date':collision}]),owner)[0]
latest=json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{fresh['id']}';"));current_e=event_for(fresh)
request2=f"'{fresh['id']}','{latest['updated_at']}','update',{literal({**fields,'title':'Must not save','status':'completed','due_date':move_to})},null,'this','{result['series_version']}','{collision}','{current_e['version']}',true,false"
sql('select public.task_app_reschedule_special_task('+request2+');',owner,fail='P0409')
check('schedule collision rolls back task fields and dates',sql(f"select title='{fresh['title']}'and due_date='{move_to}'from public.tasks where id='{fresh['id']}';")=='t')
for role in ['anon','service_role']:
 check(role+' cannot invoke rescheduling RPC',sql(f"select not has_function_privilege('{role}','public.task_app_reschedule_special_task(uuid,timestamptz,text,jsonb,text,text,timestamptz,date,timestamptz,boolean,boolean)','execute');")=='t')
check('authenticated cannot access activation snapshot table directly',sql("select not has_table_privilege('authenticated','public.task_special_activations','select');")=='t')
sql((root/'supabase/migrations/202610160037_special_meeting_date_edit.sql').read_text(),fail='037 already installed')
check('037 replay is rejected',True)
