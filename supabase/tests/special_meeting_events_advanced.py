# Executes only inside the network-isolated runner's disposable PostgreSQL.
def event_for(task,user=owner):
 state=rpc('task_app_special_state','',user);plan=next(p for p in state['plans']if p['id']==task['special_plan_id']);return next(e for e in state['meetings']if e['id']==plan['meetingId'])
# Two independent plans in the same event; new plans always start locked.
u=rpc('task_app_create_tasks',literal([{**fields,'title':'Independent preparation'}]),owner)[0]
e2=event_for(u);rpc('task_app_set_special_locked',f"'{e2['id']}','{e2['version']}',false,true",owner)
v=rpc('task_app_create_tasks',literal([{**fields,'title':'Created while event activated'}]),owner)[0]
check('new task is locked even inside an activated event',not v['special_enabled'])
sql(f"select public.task_app_mutate('{v['id']}','{v['updated_at']}','status',null,'completed');",member,fail='P0036')
# Existing regular task cannot be completed behind the UI while event activated.
regular=sql("select to_jsonb(t)from public.tasks t where id='00000000-0000-4000-8000-000000000811';")
regular=json.loads(regular)
sql(f"select public.task_app_mutate('{regular['id']}','{regular['updated_at']}','status',null,'completed');",owner,fail='P0036')
# Overlapping schedule rejected; dates cannot be moved by bypassing form controls.
overlap=rpc('task_app_create_tasks',literal([{**fields,'title':'Overlapping schedule','special_days':2}]),owner)[0];oe=event_for(overlap)
sql(f"select public.task_app_set_special_locked('{oe['id']}','{oe['version']}',false,true);",owner,fail='P0037')
us=json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{u['id']}';"))
sql(f"select public.task_app_mutate('{u['id']}','{us['updated_at']}','update',{literal({**fields,'due_date':nextday})});",owner,fail='23514')
# Versioned permanent reassignment updates only the bounded future plan.
q=rpc('task_app_create_tasks',literal([{**fields,'title':'Bounded reassignment test'}]),owner)[0]
qs=rpc('task_app_special_state','',owner);qp=next(p1 for p1 in qs['plans']if p1['id']==q['special_plan_id'])
qr=rpc('task_app_reassign_special',f"'{q['id']}','{q['updated_at']}','update',{literal({**fields,'title':q['title'],'assigned_to_member_id':ownmember})},null,'this','{qp['version']}'",coord)
check('permanent Special reassignment retains manager and version safeguards',qr['assigned_to_member_id']==ownmember and qr['series_version']!=qp['version'])
stale=rpc('task_app_reassign_special',f"'{q['id']}','{qr['updated_at']}','update',{literal({**fields,'title':q['title']})},null,'this','{qp['version']}'",coord)
check('stale bounded plan reassignment rejected without changing assignee',stale.get('conflict')is True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 list(pool.map(lambda _:sql(f"select public.task_app_release_special('{owner}','{nextday}T00:00:00+05:30');"),range(2)))
check('parallel rollover creates one independently assigned next-day task',sql(f"select count(*)from public.tasks where special_plan_id='{q['special_plan_id']}'and due_date='{nextday}'and assigned_to_member_id='{ownmember}';")=='1')
sql(f"select public.task_app_reassign_special('{q['id']}','{qr['updated_at']}','update',{literal({**fields,'title':q['title']})},null,'this','{qr['series_version']}');",coord,fail='P0409')
check('stale previous-day future edit cannot silently miss a materialized later day',True)
context=f"set request.jwt.claim.sub='{owner}';set request.jwt.claim.session_id='{sessions[owner]}';"
check('attendance allows only selected current event day',sql(context+f"select public.task_app_attendance_change_open('Special Meeting','{day}','{day}T10:00:00+05:30')and not public.task_app_attendance_change_open('Special Meeting','{nextday}','{day}T10:00:00+05:30');")=='t')
check('regular attendance is blocked while Special is active',sql(context+f"select not public.task_app_attendance_change_open('Healing Meeting',null,'{day}T10:00:00+05:30')and not public.task_app_service_attendance_open('morning','{day}T10:00:00+05:30');")=='t')
# Missed completion executes real RPC at a fictional eligible time in this disposable DB.
original_missed=sql("select pg_get_functiondef('public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure);")
sql(original_missed.replace('at_time:=clock_timestamp();',f"at_time:='{day}T20:00:00+05:30'::timestamptz;"))
fines_before=sql('select count(*)from public.task_fines;')
missed=rpc('task_app_complete_missed',f"'{u['id']}','{us['updated_at']}',true",coord)
check('Special Missed succeeds without fine setup or new fine',missed['status']=='completed'and missed['missed_completion_role']=='coordinator'and sql('select count(*)from public.task_fines;')==fines_before)
sql(f"select public.task_app_mutate('{u['id']}','{missed['updated_at']}','status',null,'active');",owner,fail='P0403')
r=rpc('task_app_mutate',f"'{u['id']}','{missed['updated_at']}','status',null,'active'",coord)
check('only recorded Missed actor reopens; no fine is introduced',r['status']=='active'and sql('select count(*)from public.task_fines;')==fines_before)
# A forced absence covers this day only, never tomorrow's independent daily occurrence.
a=sql(f"select id from public.account_member_absences where restriction_actor_id='{cm}'and member_id='{mm}'and meeting_date='{day}'order by created_at desc limit 1;")
sql(f"select public.task_app_release_special('{owner}','{nextday}T00:00:00+05:30');")
check('Missed restriction is day-specific',sql(f"select public.task_app_restriction_covers(t,a,'{day}T20:30:00+05:30')from public.tasks t,public.account_member_absences a where t.id='{u['id']}'and a.id='{a}';")=='t'and sql(f"select not public.task_app_restriction_covers(t,a,'{nextday}T00:30:00+05:30')from public.tasks t,public.account_member_absences a where t.special_plan_id='{u['special_plan_id']}'and t.due_date='{nextday}'and a.id='{a}';")=='t')
sql(original_missed)
# Relocking must keep replacement history so delayed assessment skips covered regular occurrences.
ue=event_for(u);rpc('task_app_set_special_locked',f"'{ue['id']}','{ue['version']}',true,true",owner)
regular_day=sql(f"select d::date from generate_series(date '{day}',date '{day}'+2,interval '1 day')d where extract(dow from d)in(0,3,5)order by d limit 1;")
regular_name=sql(f"select case extract(dow from date '{regular_day}')when 0 then 'Sunday Service'when 3 then 'Healing Meeting'else 'Revival Meeting'end;")
regular_cat=sql(f"select id from public.categories where owner_id='{owner}'and name='{regular_name}';")
cutoff=sql(f"select(date '{regular_day}'+1+time '01:00')at time zone 'Asia/Kolkata';")
sql(f"insert into public.task_special_activations(owner_id,meeting_id,opened_at,closed_at)values('{owner}','{ue['id']}','{regular_day}T10:00:00+05:30','{regular_day}T11:00:00+05:30');")
check('replacement exemption survives relock and later checks',sql(f"select public.task_app_special_replaced('{owner}','{regular_name}','{regular_day}','{cutoff}');")=='t')
candidate='00000000-0000-4000-8000-000000009001'
sql(f"update public.task_fine_configuration set enabled_at='{regular_day}T00:00:00+05:30';insert into public.task_fine_candidates(owner_id,task_id,title,category_id,category_name,member_id,member_name,scheduled_date,due_at,cutoff_at,completed,deleted,created_at)values('{owner}','{candidate}','Covered regular task','{regular_cat}','{regular_name}','{mm}','Sarah','{regular_day}','{regular_day}T23:50:00+05:30','{cutoff}',false,false,'{regular_day}T00:00:01+05:30');select public.task_app_finalize_fine('{candidate}','{cutoff}');")
check('delayed fine worker skips replaced occurrence after relock',sql(f"select finalized and not exists(select 1 from public.task_fines where task_id='{candidate}')from public.task_fine_candidates where task_id='{candidate}';")=='t')
# Deleting a completed old occurrence does not cancel the following daily plan.
plan=t['special_plan_id'];sql(f"delete from public.tasks where id='{t['id']}';")
sql(f"select public.task_app_release_special('{owner}','{day}T22:00:00+05:30');")
check('physical deletion does not resurrect a completed daily occurrence',sql(f"select count(*)from public.tasks where special_plan_id='{plan}'and due_date='{day}';")=='0')
check('completed physical cleanup keeps the bounded daily plan',sql(f"select not cancelled from public.task_special_plans where id='{plan}';")=='t')
# Moving active task to Bin cancels future daily releases.
v=json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{v['id']}';"))
rpc('task_app_mutate',f"'{v['id']}','{v['updated_at']}','delete'",owner)
check('moving Special task to Bin cancels its daily plan',sql(f"select cancelled from public.task_special_plans where id='{v['special_plan_id']}';")=='t')
deleted=json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{v['id']}';"))
rpc('task_app_bin',"'restore',"+literal([{'id':deleted['id'],'version':deleted['updated_at']}])+',true',owner)
check('Bin restoration resumes the finite daily plan',sql(f"select not cancelled from public.task_special_plans where id='{v['special_plan_id']}';")=='t')
for role in ['anon','authenticated','service_role']:
 check(role+' cannot invoke private Special helpers',sql(f"select bool_and(not has_function_privilege('{role}',oid,'execute'))from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_prepare_special','task_app_release_special','task_app_mutate_special','task_app_before_special_mutate','task_app_special_active','task_app_special_replaced','task_app_special_record_release');")=='t')

# Confirm ordinary meeting behaviour returns after relock.
regular=json.loads(sql("select to_jsonb(t)from public.tasks t where id='00000000-0000-4000-8000-000000000811';"))
r=rpc('task_app_mutate',f"'{regular['id']}','{regular['updated_at']}','status',null,'completed'",owner)
check('ordinary task completion still works after relock',r['status']=='completed')
# Far-future activation does not replace today's meetings.
future=sql(f"select date '{day}'+10;")
f=rpc('task_app_create_tasks',literal([{**fields,'title':'Future prepared meeting','due_date':future,'special_days':None}]),owner)[0];fe=event_for(f)
rpc('task_app_set_special_locked',f"'{fe['id']}','{fe['version']}',false,true",coord)
check('future activation respects scheduled midnight start',sql(f"select public.task_app_special_active('{owner}',clock_timestamp())is null;")=='t')
check('blank duration has one occurrence and exact next-day deadline',sql(f"select public.task_app_special_end(e)=((date '{future}'+2)::timestamp at time zone 'Asia/Kolkata')from public.task_special_meetings e where id='{fe['id']}';")=='t')

# An adopted undated task can explicitly fill its original meeting start date.
undated=json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{legacy[3]['id']}';"));le=event_for(undated)
r=rpc('task_app_mutate',f"'{undated['id']}','{undated['updated_at']}','update',{literal({**legacy_fields,'title':'Legacy undated explicitly scheduled','due_date':le['startDate'],'due_time':None,'special_days':None,'repeat_rule':'daily'})}",owner)
check('adopted undated tasks can be explicitly scheduled without moving their meeting',r['due_date']==le['startDate']and r['id']==undated['id'])
