#!/usr/bin/env python3
"""044 upgrade checks in disposable, network-isolated PostgreSQL; never hosted."""
from pathlib import Path
import ast
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
old="for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())"
assert source.count(old)==1
source=source.replace(old,"for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if '0044_'not in path.name:sql(path.read_text())")
clock_ast=ast.parse((root/'supabase/tests/current_schema_regressions.py').read_text())
clock_code=next(ast.literal_eval(n.value)for n in clock_ast.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='clock_setup'for t in n.targets))
cases=r'''
cat=sql(f"select id from public.categories where owner_id='{owner}'and name='Healing Meeting';")
f={'title':'Meeting schedule audit','notes':'Fictional only','status':'active','due_date':'2026-12-23','due_time':'23:50','priority':'medium','category_id':cat,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
def create(**patch):return rpc('task_app_create_tasks',literal([{**f,**patch}]),owner)[0]
def edit(t,patch,user=owner,scope='this'):
 fields={**f,**{k:t[k]for k in f if k in t},**patch}
 if fields.get('due_time'):fields['due_time']=fields['due_time'][:5]
 return rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','update',{literal(fields)},null,'{scope}','{t['updated_at']}'",user)
legacy_date=create(title='Legacy off-day',due_date='2026-12-25')
legacy_daily=create(title='Legacy daily',repeat_rule='daily')
legacy_bin=create(title='Legacy daily in Bin',repeat_rule='daily')
legacy_bin=rpc('task_app_mutate',f"'{legacy_bin['id']}','{legacy_bin['updated_at']}','delete',null,null,'this',null",owner)
done=rpc('task_app_mutate',f"'{legacy_daily['id']}','{legacy_daily['updated_at']}','status',null,'completed'",member)
legacy_pending=sql(f"select id from public.task_repeat_pending where source_task_id='{done['id']}';")
rows_sql="select jsonb_object_agg(tablename,rows)from(select c.relname tablename,query_to_xml(format('select * from public.%I order by ctid',c.relname),false,true,'')::text rows from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r')x;"
# Row ordering uses physical order solely to prove the upgrade performs zero DML.
before_rows=sql(rows_sql)
before_functions=sql("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid)))from pg_proc where pronamespace='public'::regnamespace and prokind='f';")
sql((root/'supabase/migrations/202611030044_regular_meeting_schedules.sql').read_text())
check('044 preserves every existing app row',before_rows==sql(rows_sql))
old_functions=json.loads(before_functions)
after_functions=json.loads(sql("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid)))from pg_proc where pronamespace='public'::regnamespace and prokind='f';"))
check('044 preserves every existing function body',all(after_functions.get(k)==v for k,v in old_functions.items()))
for category,dates,bad,days in [('Sunday Service',['2026-12-20','2026-12-21'],'2026-12-22',[0,1]),('Healing Meeting',['2026-12-23','2026-12-24'],'2026-12-25',[3,4]),('Revival Meeting',['2026-12-25','2026-12-26'],'2026-12-27',[5,6])]:
 c=sql(f"select id from public.categories where owner_id='{owner}'and name='{category}';")
 service={'sunday_service':'morning'}if category=='Sunday Service'else{}
 for day in dates:
  t=create(category_id=c,due_date=day,**service)
  check(category+' allows '+day,t['due_date']==day)
 expect(category+' rejects off-day',f"select public.task_app_create_tasks({literal([{**f,**service,'category_id':c,'due_date':bad}])});",owner,'P0044')
 for rule in ('daily','monthly'):
  expect(category+' rejects '+rule,f"select public.task_app_create_tasks({literal([{**f,**service,'category_id':c,'due_date':dates[0],'repeat_rule':rule}])});",owner,'P0044')
 t=create(category_id=c,due_date=dates[0],repeat_rule='weekly',weekdays=days,**service)
 check(category+' allows both weekly meeting days',t['weekdays']==days)
 expect(category+' rejects off-day repeat',f"select public.task_app_create_tasks({literal([{**f,**service,'category_id':c,'due_date':dates[0],'repeat_rule':'weekly','weekdays':days+[2]}])});",owner,'P0044')
check('undated one-off task remains allowed',create(due_date=None,due_time=None)['due_date']is None)
count=sql('select count(*)from public.tasks;')
expect('batch fails atomically on invalid second task',f"select public.task_app_create_tasks({literal([f,{**f,'due_date':'2026-12-25'}])});",owner,'P0044')
check('invalid batch did not create a partial task',sql('select count(*)from public.tasks;')==count)
expect('Coordinator must use valid meeting dates',f"select public.task_app_create_tasks({literal([{**f,'due_date':'2026-12-25'}])});",coord,'P0044')
expect('Member still cannot create tasks',f"select public.task_app_create_tasks({literal([f])});",member,'P0403')
legacy_date=edit(legacy_date,{'title':'Legacy title preserved','assigned_to_member_id':cm},coord)
check('legacy off-day task can be renamed and reassigned',legacy_date['title']=='Legacy title preserved'and legacy_date['due_date']=='2026-12-25'and legacy_date['assigned_to_member_id']==cm)
expect('changing legacy schedule to another invalid date is rejected',f"select public.task_app_mutate('{legacy_date['id']}','{legacy_date['updated_at']}','update',{literal({**f,'due_date':'2026-12-26','assigned_to_member_id':cm})},null,'this',null);",owner,'P0044')
fixed=edit(legacy_date,{'due_date':'2026-12-24'})
check('legacy off-day task can be corrected explicitly',fixed['due_date']=='2026-12-24')
expect('pending schedule cannot change to off-day',f"update public.task_repeat_pending set due_date='2026-12-25'where id='{legacy_pending}';",None,'P0044')
# Existing daily schedule retains its reserved successor, even though new Daily schedules are blocked.
sql(f"select public.task_app_release_repeats('{owner}','2026-12-24T10:00:00+05:30');")
check('legacy pending occurrence is preserved and released',sql(f"select count(*)from public.tasks where id='{legacy_pending}'and repeat_rule='daily';")=='1')
legacy_next=json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{legacy_pending}';"))
legacy_next=edit(legacy_next,{'title':'Legacy daily reassigned','assigned_to_member_id':cm},coord)
check('legacy repeat can keep its unchanged schedule',legacy_next['repeat_rule']=='daily'and legacy_next['assigned_to_member_id']==cm)
legacy_off=edit(legacy_next,{'repeat_rule':'off'})
check('legacy repeat can be stopped safely',legacy_off['repeat_rule']=='off')
restored=rpc('task_app_bin','\'restore\','+literal([{'id':legacy_bin['id'],'version':legacy_bin['updated_at']}])+',true',owner)
check('legacy Bin repeat restores without losing its saved schedule',restored['resumed']==1 and sql(f"select repeat_rule from public.tasks where id='{legacy_bin['id']}'and deleted_at is null;")=='daily')
# Future-only changes also validate the queued payload, rolling back the whole RPC.
weekly=create(repeat_rule='weekly',weekdays=[3]);weekly=rpc('task_app_mutate',f"'{weekly['id']}','{weekly['updated_at']}','status',null,'completed'",member)
queued=sql(f"select due_date from public.task_repeat_pending where source_task_id='{weekly['id']}';")
expect('future edit rejects invalid repeat schedule',f"select public.task_app_mutate('{weekly['id']}','{weekly['updated_at']}','update',{literal({**f,'status':'completed','repeat_rule':'weekly','weekdays':[3,5]})},null,'future','{weekly['updated_at']}');",owner,'P0044')
check('rejected future edit keeps queued date',sql(f"select due_date from public.task_repeat_pending where source_task_id='{weekly['id']}';")==queued)
special=sql(f"select id from public.categories where owner_id='{owner}'and name='Special Meeting';")
s=create(category_id=special,due_date='2026-12-22',special_days=3,repeat_rule='daily')
check('Special daily schedule is unchanged',s['special_plan_id']is not None and not s['special_enabled'])
for signature in ['task_app_regular_schedule_valid(text,date,text,smallint[])','task_app_guard_regular_schedule()','task_app_guard_regular_pending()']:
 for role in ('anon','authenticated','service_role'):
  check(signature+' private from '+role,sql(f"select has_function_privilege('{role}','public.{signature}','execute');")=='f')
check('both schedule triggers enabled',sql("select count(*)from pg_trigger where tgname in('tasks_ac_regular_schedule','task_repeat_pending_regular_schedule')and tgenabled='O';")=='2')
report=json.loads(sql((root/'supabase/verification/20261103_regular_meeting_schedules.sql').read_text()))
check('read-only044 postcheck has no issues',report['installed']and report['enabledTriggers']==2 and not report['issues'])
expect('migration replay refused',(root/'supabase/migrations/202611030044_regular_meeting_schedules.sql').read_text(),None,'044 already installed')
check('existing explicit grants and RLS remain intact',not json.loads(sql((root/'supabase/verification/20261027_explicit_grants_checks.sql').read_text()))['issues'])
print('PASS all044 regular schedule upgrade regressions',flush=True)
'''
program=source+'\n'+'\n'.join(' '+line if line else ''for line in (clock_code+'\n'+cases).splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
