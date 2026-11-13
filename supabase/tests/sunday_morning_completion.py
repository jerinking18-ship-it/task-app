#!/usr/bin/env python3
"""045 boundary/integration tests; disposable network-none PostgreSQL only."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
source=source.replace("for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())", "for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name<'202611130045':sql(path.read_text())")
cases=r'''
rpc('task_app_setup',"'bootstrap',null",owner)
categories=json.loads(sql(f"select jsonb_object_agg(name,id)from public.categories where owner_id='{owner}';"))
def rows():
 return [sql(f"select coalesce(jsonb_agg(v order by v::text),'[]')from(select to_jsonb(t)v from public.\"{table}\"t)s;")for table in json.loads(sql("select jsonb_agg(relname order by relname)from pg_class where relnamespace='public'::regnamespace and relkind='r';"))]
security="select md5(jsonb_agg(jsonb_build_array(oid,proowner,proacl,prosecdef,proconfig)order by oid)::text)from pg_proc where pronamespace='public'::regnamespace and prokind='f';"
before=rows();grants=sql(security)
other_functions=sql("select md5(jsonb_agg(jsonb_build_array(oid,prosrc)order by oid)::text)from pg_proc where pronamespace='public'::regnamespace and prokind='f'and proname not in('task_app_completion_open','task_app_missed_timing_open');")
migration=(root/'supabase/migrations/202611130045_sunday_morning_completion.sql').read_text()
sql(migration)
check('read-only045 verification reports no issues',sql((root/'supabase/verification/20261113_sunday_morning_completion_checks.sql').read_text())=='')
check('045 preserves every public table row',before==rows())
check('045 preserves function owners grants search paths and definer settings',grants==sql(security))
check('045 changes only the two timing helper bodies',other_functions==sql("select md5(jsonb_agg(jsonb_build_array(oid,prosrc)order by oid)::text)from pg_proc where pronamespace='public'::regnamespace and prokind='f'and proname not in('task_app_completion_open','task_app_missed_timing_open');"))
sql(migration,fail='045 already installed; never replay')
sql("create table public.sunday_test_clock(at_time timestamptz);insert into public.sunday_test_clock values('2026-12-20T10:00:00+05:30');create function public.sunday_test_now()returns timestamptz language sql stable security definer set search_path=''as $$select at_time from public.sunday_test_clock$$;revoke all on public.sunday_test_clock from public,anon,authenticated,service_role;revoke all on function public.sunday_test_now()from public,anon,authenticated,service_role;")
import re
for definition in json.loads(sql("select jsonb_agg(pg_get_functiondef(oid))from pg_proc where pronamespace='public'::regnamespace and prokind='f'and proname<>'sunday_test_now'and(prosrc like '%clock_timestamp()%'or prosrc like '%statement_timestamp()%'or prosrc like '%now()%');")):
 definition=re.sub(r'(?<![\w.])now\(\)','public.sunday_test_now()',definition)
 sql(definition.replace('clock_timestamp()','public.sunday_test_now()').replace('statement_timestamp()','public.sunday_test_now()'))
def clock(stamp):sql(f"update public.sunday_test_clock set at_time='{stamp}';")
def fields(assignee=mm,day='2026-12-20',service='morning',category='Sunday Service',**extra):
 return {'title':'Fictional Sunday cutoff task','notes':'Only disposable test data','status':'active','due_date':day,'due_time':None,'priority':'medium','category_id':categories[category],'weekdays':[],'repeat_rule':'off','assigned_to_member_id':assignee,'sunday_service':service if category=='Sunday Service'else None,**extra}
def create(f):return rpc('task_app_create_tasks',literal([f]),owner)[0]
def fresh(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def change(t,user,status='completed',fail=None):
 q=f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','status',null,'{status}','this',null);"
 return sql(q,user,fail)if fail else json.loads(sql(q,user))
def checkin(user):rpc('task_app_check_in',f"'{categories['Sunday Service']}','2026-12-20','morning',null,true",user)
def helper(t,stamp,missed=False,category='Sunday Service'):
 return sql(f"select public.task_app_{'missed_timing_open'if missed else'completion_open'}(t,"+(f"'{category}',"if missed else'')+f"'{stamp}')from public.tasks t where id='{t['id']}';")=='t'
morning=create(fields());monday=create(fields(day='2026-12-21'));undated=create(fields(day=None))
for t in (morning,monday,undated):
 for stamp,want in [('2026-12-19T23:59:59.999999+05:30',False),('2026-12-20T00:00:00+05:30',True),('2026-12-20T16:00:00+05:30',True),('2026-12-20T17:59:59.999999+05:30',True),('2026-12-20T18:00:00+05:30',False),('2026-12-21T10:00:00+05:30',False)]:
  check('Morning normal exact own-Sunday cutoff '+str(t['due_date'])+' '+stamp,helper(t,stamp)==want)
check('dated Morning never unlocks next Sunday',not helper(morning,'2026-12-27T10:00:00+05:30'))
check('undated Morning may use next current Sunday',helper(undated,'2026-12-27T10:00:00+05:30'))
for stamp,want in [('2026-12-20T08:59:59.999999+05:30',False),('2026-12-20T09:00:00+05:30',True),('2026-12-20T16:00:00+05:30',True),('2026-12-20T17:59:59.999999+05:30',True),('2026-12-20T18:00:00+05:30',False),('2026-12-27T10:00:00+05:30',False)]:
 check('Morning Missed exact cutoff '+stamp,helper(morning,stamp,True)==want)
evening=create(fields(service='evening'))
check('Evening normal remains open after 6PM and Monday',helper(evening,'2026-12-20T18:00:00+05:30')and helper(evening,'2026-12-21T10:00:00+05:30'))
check('Evening Missed still opens7PM and closes1AM',not helper(evening,'2026-12-20T18:00:00+05:30',True)and helper(evening,'2026-12-20T19:00:00+05:30',True)and not helper(evening,'2026-12-21T01:00:00+05:30',True))
for category,day in [('Healing Meeting','2026-12-23'),('Revival Meeting','2026-12-25')]:
 t=create(fields(category=category,day=day));check(category+' unaffected after6PM',helper(t,day+'T18:00:00+05:30',category=category))
for user,m in[(member,mm),(coord,cm),(owner,ownmember)]:
 clock('2026-12-20T10:00:00+05:30');t=create(fields(assignee=m));change(t,user,fail='P0043');checkin(user)
 clock('2026-12-20T16:00:00+05:30');done=change(t,user);check('checked-in normal completion after4PM '+user,done['status']=='completed')
 active=change(done,user,'active');clock('2026-12-20T17:59:59.999999+05:30');done=change(active,user)
 clock('2026-12-20T18:00:00+05:30');active=change(done,user,'active');check('normal reopening remains allowed after6PM '+user,active['status']=='active')
 before=rows();change(active,user,fail='P0038');check('normal completion rejected atomically at6PM '+user,before==rows())
 q=f"select public.task_app_mutate('{active['id']}','{active['updated_at']}','update',{literal(fields(assignee=m,status='completed'))},null,'this',null);"
 sql(q,user,'P0403'if user==member else'P0038');check('editor cannot bypass6PM '+user,fresh(active)['status']=='active')
clock('2026-12-20T10:00:00+05:30');sql('select public.task_app_enable_fines();')
for user,target in[(coord,ownmember),(owner,cm)]:
 t=create(fields(assignee=target));clock('2026-12-20T17:59:59.999999+05:30')
 done=rpc('task_app_complete_missed',f"'{t['id']}','{t['updated_at']}',true",user)
 check('checked-in manager can mark Missed before6PM '+user,fresh(t)['status']=='completed')
 check('Missed still issues its immediate fine '+user,int(sql(f"select count(*)from public.task_fines where task_id='{t['id']}';"))==1)
 clock('2026-12-20T18:00:00+05:30');active=change(fresh(t),user,'active')
 before=rows();sql(f"select public.task_app_complete_missed('{active['id']}','{active['updated_at']}',true);",user,'P0014');check('Missed rejects at6PM with no new side effects '+user,before==rows())
 # Disposable fixture only: remove its new restriction so the next actor remains eligible.
 sql("delete from public.account_member_absences;");clock('2026-12-20T10:00:00+05:30')
sql(f"select public.task_app_completion_open(t,now())from public.tasks t where id='{morning['id']}';",member,'42501')
check('timing helpers remain private',sql("select bool_and(not has_function_privilege('authenticated',oid,'execute'))from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_completion_open','task_app_missed_timing_open');")=='t')
print('PASS all045 Sunday Morning completion regressions',flush=True)
'''
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
