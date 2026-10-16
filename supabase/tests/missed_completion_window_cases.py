"""Fictional identities and clocks only; invoked by isolated window harness."""
def digest():
 return sql("select md5(jsonb_build_object('tasks',(select jsonb_agg(t)from public.tasks t),'users',(select jsonb_agg(t)from auth.users t),'members',(select jsonb_agg(t)from public.account_members t),'fineconfig',(select jsonb_agg(t)from public.task_fine_configuration t),'fines',(select jsonb_agg(t)from public.task_fines t),'totals',(select jsonb_agg(t)from public.member_completion_totals t))::text);")
before=digest()
acl=sql("select md5(string_agg(oid::text||proowner::text||coalesce(proacl::text,''),'|'order by oid))from pg_proc where oid in('public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure,'public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure);")
completion_before=sql("select pg_get_functiondef('public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure);")
sql((root/'supabase/migrations/202610160030_missed_completion_window.sql').read_text())
check('030 preserves existing data and activation',before==digest())
check('030 preserves existing RPC body and after-lock check',sql("select pg_get_functiondef('public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure);")==completion_before)
check('030 preserves helper and RPC owner/grants',sql("select md5(string_agg(oid::text||proowner::text||coalesce(proacl::text,''),'|'order by oid))from pg_proc where oid in('public.task_app_missed_timing_open(public.tasks,text,timestamptz)'::regprocedure,'public.task_app_complete_missed(uuid,timestamptz,boolean)'::regprocedure);")==acl)
for role in ['anon','authenticated','service_role']:
 check(role+' cannot call timing helper',sql(f"select has_function_privilege('{role}','public.task_app_missed_timing_open(public.tasks,text,timestamptz)','execute');")=='f')
sql((root/'supabase/migrations/202610160030_missed_completion_window.sql').read_text(),fail='already changed; never replay')
check('030 refuses replay',True)
rpc('task_app_setup',"'bootstrap',null",owner)
cats={v['name']:v['id']for v in json.loads(sql(f"select jsonb_agg(jsonb_build_object('id',id,'name',name))from public.categories where owner_id='{owner}';"))}
sql('select public.task_app_enable_fines();')
sql("create table public.missed_window_test_clock(at_time timestamptz);insert into public.missed_window_test_clock values('2026-12-20T18:59:59+05:30');create function public.missed_window_test_now()returns timestamptz language sql volatile set search_path=''as $$select at_time from public.missed_window_test_clock$$;revoke all on function public.missed_window_test_now()from public,anon,authenticated,service_role;")
sql(completion_before.replace('clock_timestamp()','public.missed_window_test_now()'))
def clock(stamp):sql(f"update public.missed_window_test_clock set at_time='{stamp}';")
def create(category='Sunday Service',date='2026-12-20',**changes):
 fields={'title':'Fictional meeting work','notes':None,'status':'active','due_date':date,'due_time':'23:50'if date else None,'priority':'medium','category_id':cats[category],'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm,'sunday_service':'evening'if category=='Sunday Service'else None}
 return rpc('task_app_create_tasks',literal([{**fields,**changes}]),owner)[0]
def query(t):return f"select public.task_app_complete_missed('{t['id']}','{t['updated_at']}',true);"
def missed(t,who=coord):return json.loads(sql(query(t),who))
def fine_count(t):return sql(f"select count(*)from public.task_fines where task_id='{t['id']}';")
def denied(t,stamp,who=coord):
 clock(stamp);before=digest();sql(query(t),who,fail='P0014');check('closed window is atomic '+stamp,digest()==before)
def helper(t,category,stamp):return sql(f"select public.task_app_missed_timing_open(t,'{category}','{stamp}')from public.tasks t where id='{t['id']}';")=='t'
for category,day,nextday in [('Sunday Service','2026-12-20','2026-12-21'),('Healing Meeting','2026-12-23','2026-12-24'),('Revival Meeting','2026-12-25','2026-12-26'),('Special Meeting','2026-12-26','2026-12-27')]:
 t=create(category,day)
 for stamp,want in [(day+'T18:59:59.999999+05:30',False),(day+'T19:00:00+05:30',True),(day+'T23:59:59+05:30',True),(nextday+'T00:00:00+05:30',True),(nextday+'T00:59:59.999999+05:30',True),(nextday+'T01:00:00+05:30',False),(nextday+'T19:00:00+05:30',False)]:
  check(category+' boundary '+stamp,helper(t,category,stamp)==want)
 for who in [owner,coord]:
  task=create(category,day);denied(task,day+'T18:59:59+05:30',who);clock(day+'T19:00:00+05:30');done=missed(task,who)
  check(category+' both managerial roles complete inside window',done['status']=='completed'and done['completed_by_member_id']==(ownmember if who==owner else cm)and done['assigned_to_member_id']==mm and done['missed_completion_role']==('owner'if who==owner else 'coordinator')and fine_count(task)=='1')
  # Reopening remains exact-actor-only, even after the completion window closes.
  clock(nextday+'T12:00:00+05:30');other=coord if who==owner else owner
  reopen=f"select public.task_app_mutate('{done['id']}','{done['updated_at']}','status',null,'active','this',null);"
  sql(reopen,other,fail='P0403');sql(reopen,member,fail='P0403');sql(reopen,who)
  check('recorded actor can reopen outside window; fine remains',fine_count(task)=='1')
# Existing availability and actor restrictions still apply in an open window.
clock('2026-12-20T19:00:00+05:30');t=create();sql(query(t),member,fail='P0403');sql(query(t),unverified,fail='P0403')
own=create(assigned_to_member_id=cm);sql(query(own),coord,fail='P0403')
clock('2026-12-20T09:00:00+05:30');rpc('task_app_mutate',f"'{own['id']}','{own['updated_at']}','status',null,'completed','this',null",coord)
check('ordinary own completion still works outside Missed window',sql(f"select status from public.tasks where id='{own['id']}';")=='completed'and fine_count(own)=='0')
# Midnight lock race: server must check the time after waiting for mutation locks.
locked=create();clock('2026-12-21T00:59:59+05:30')
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 holder=pool.submit(sql,f"begin;select task_id from public.task_fine_candidates where task_id='{locked['id']}'for update;select pg_sleep(2);commit;")
 time.sleep(.2);action=pool.submit(sql,query(locked),coord,'P0014')
 for _ in range(30):
  if sql("select exists(select 1 from pg_stat_activity where state='active'and wait_event_type='Lock'and query like '%task_app_complete_missed%');")=='t':break
  time.sleep(.05)
 else:raise AssertionError('Missed request did not wait for candidate lock')
 clock('2026-12-21T01:00:00+05:30');holder.result();action.result()
check('request crossing1AM after lock creates no fine/completion',fine_count(locked)=='0'and sql(f"select status from public.tasks where id='{locked['id']}';")=='active')

for category,day,nextday in [('Sunday Service','2026-12-20','2026-12-21'),('Healing Meeting','2026-12-23','2026-12-24'),('Revival Meeting','2026-12-25','2026-12-26')]:
 t=create(category,None)
 check(category+' undated evening open',helper(t,category,day+'T19:00:00+05:30'))
 check(category+' undated following early morning open',helper(t,category,nextday+'T00:59:59+05:30'))
 check(category+' undated morning and next evening closed',not helper(t,category,day+'T09:00:00+05:30')and not helper(t,category,nextday+'T19:00:00+05:30'))
for service in ['morning','evening']:
 t=create(sunday_service=service)
 check(service+' distinct Sunday Missed window',helper(t,'Sunday Service','2026-12-20T10:00:00+05:30'if service=='morning'else'2026-12-20T19:00:00+05:30'))
old=create();check('dated occurrence cannot return in next meeting',not helper(old,'Sunday Service','2026-12-27T19:00:00+05:30'))
following=create(date='2026-12-21')
check('following-day date retains only remaining own meeting window',helper(following,'Sunday Service','2026-12-21T00:30:00+05:30')and not helper(following,'Sunday Service','2026-12-20T19:00:00+05:30'))
wrong=create(date='2026-12-22');check('date outside category period not guessed into later meeting',not helper(wrong,'Sunday Service','2026-12-27T19:00:00+05:30'))
special=create('Special Meeting',None,weekdays=[0,3])
check('Special selected weekdays include own midnight tail',helper(special,'Special Meeting','2026-12-23T19:00:00+05:30')and helper(special,'Special Meeting','2026-12-24T00:30:00+05:30')and not helper(special,'Special Meeting','2026-12-24T19:00:00+05:30'))
fallback=create('Special Meeting',None)
sql(f"alter table public.tasks disable trigger user;update public.tasks set created_at='2026-12-20T20:00:00+05:30'where id='{fallback['id']}';alter table public.tasks enable trigger user;")
check('Special legacy fallback cannot precede creation or recur next week',not helper(fallback,'Special Meeting','2026-12-20T19:00:00+05:30')and helper(fallback,'Special Meeting','2026-12-20T20:00:00+05:30')and helper(fallback,'Special Meeting','2026-12-21T00:30:00+05:30')and not helper(fallback,'Special Meeting','2026-12-21T01:00:00+05:30')and not helper(fallback,'Special Meeting','2026-12-27T19:00:00+05:30'))
check('null/invalid clocks fail closed',sql(f"select not public.task_app_missed_timing_open(t,'Sunday Service',null)and not public.task_app_missed_timing_open(t,'Sunday Service','infinity')from public.tasks t where id='{old['id']}';")=='t')
check('unknown category fails closed',not helper(old,'Other','2026-12-20T19:00:00+05:30'))
# Restore the production clock before checking the deployment definition.
sql(completion_before)
check('new030 read-only deployment postchecks all zero',all(line.rsplit('|',1)[1]=='0'for line in sql((root/'supabase/verification/20261016_missed_window_checks.sql').read_text()).splitlines()))
