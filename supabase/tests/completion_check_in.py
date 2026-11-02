#!/usr/bin/env python3
"""043 integration tests. Disposable PostgreSQL with --network none; never hosted."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
source=source.replace("for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())", "for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name<'202611020043':sql(path.read_text())")
cases=r'''
rpc('task_app_setup',"'bootstrap',null",owner)
categories=json.loads(sql(f"select jsonb_object_agg(name,id)from public.categories where owner_id='{owner}';"))
def fingerprint():
 return sql("select md5(jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relacl)order by c.relname)::text)from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r';")
def rows():
 values=[]
 for table in json.loads(sql("select jsonb_agg(relname order by relname)from pg_class where relnamespace='public'::regnamespace and relkind='r';")):
  values.append(sql(f'select coalesce(jsonb_agg(v order by v::text),\'[]\')from(select to_jsonb(t)v from public."{table}"t)s;'))
 return values
before=rows();security=fingerprint()
old_functions=sql("select md5(jsonb_agg(jsonb_build_array(oid,prosrc,proacl,proowner)order by oid)::text)from pg_proc where pronamespace='public'::regnamespace;")
old_oids=sql("select string_agg(oid::text,',')from pg_proc where pronamespace='public'::regnamespace;")
migration=(root/'supabase/migrations/202611020043_completion_check_in.sql').read_text()
sql(migration)
check('043 preserves all historical rows',before==rows())
check('043 preserves all table grants and RLS',security==fingerprint())
check('043 preserves every prior function body owner and grant',old_functions==sql(f"select md5(jsonb_agg(jsonb_build_array(oid,prosrc,proacl,proowner)order by oid)::text)from pg_proc where oid in({old_oids});"))
check('new helpers have no client or service execution',sql("select bool_and(not has_function_privilege('anon',oid,'execute')and not has_function_privilege('authenticated',oid,'execute')and not has_function_privilege('service_role',oid,'execute'))from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_has_completion_check_in','task_app_guard_completion_check_in');")=='t')
sql(migration,fail='043 already installed; never replay')
# Test-only clock in this container. Production has no client clock override.
sql("create table public.completion_test_clock(at_time timestamptz);insert into public.completion_test_clock values('2026-12-20T10:00:00+05:30');create function public.completion_test_now()returns timestamptz language sql stable security definer set search_path=''as $$select at_time from public.completion_test_clock$$;revoke all on public.completion_test_clock from public,anon,authenticated,service_role;revoke all on function public.completion_test_now()from public,anon,authenticated,service_role;")
import re
for definition in json.loads(sql("select jsonb_agg(pg_get_functiondef(oid))from pg_proc where pronamespace='public'::regnamespace and prokind='f'and proname<>'completion_test_now'and(prosrc like '%clock_timestamp()%'or prosrc like '%statement_timestamp()%'or prosrc like '%now()%');")):
 definition=re.sub(r'(?<![\w.])now\(\)','public.completion_test_now()',definition)
 sql(definition.replace('clock_timestamp()','public.completion_test_now()').replace('statement_timestamp()','public.completion_test_now()'))
def clock(stamp):sql(f"update public.completion_test_clock set at_time='{stamp}';")
def fields(category='Sunday Service',day='2026-12-20',assignee=mm,service='morning',**extra):
 return {'title':'Fictional checked task','notes':'Keep notes','status':'active','due_date':day,'due_time':None,'priority':'medium','category_id':categories[category],'sunday_service':service if category=='Sunday Service'else None,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':assignee,**extra}
def create(f):return rpc('task_app_create_tasks',literal([f]),owner)[0]
def fresh(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def change(t,user,status='completed',fail=None):
 q=f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','status',null,'{status}');"
 if fail:return sql(q,user,fail)
 return json.loads(sql(q,user))
def checkin(user,category='Sunday Service',service='morning'):
 state=rpc('task_app_check_in_state','false',user)
 c=next(c for c in state['contexts']if c['category']==category and c['service']==(service if category=='Sunday Service'else None))
 return rpc('task_app_check_in',f"'{c['categoryId']}','{c['meetingDate']}',"+(repr(c['service'])if c['service']else'null')+','+(repr(c['meetingId'])if c['meetingId']else'null')+',true',user)
def missed(t,user,fail=None):
 q=f"select public.task_app_complete_missed('{t['id']}','{t['updated_at']}',true);"
 if fail:return sql(q,user,fail)
 return json.loads(sql(q,user))
def checked(t,actor=mm):return sql(f"select public.task_app_has_completion_check_in(t,'{actor}',public.completion_test_now())from public.tasks t where id='{t['id']}';")=='t'
# Every role, normal status path. No extra permission is granted to Managers.
for user,m in[(member,mm),(coord,cm),(owner,ownmember)]:
 t=create(fields(assignee=m));change(t,user,fail='P0043');checkin(user)
 done=change(t,user);check('own normal completion requires check-in for '+user,done['status']=='completed'and done['completed_by_member_id']==m)
 # Reopening after removing the fixture's check-in is deliberately still allowed.
 sql(f"delete from public.task_member_check_ins where member_id='{m}';")
 reopened=change(done,user,'active');check('ordinary reopening does not require check-in',reopened['status']=='active')
 change(reopened,user,fail='P0043')
checkin(member)
t=create(fields(service='evening'));change(t,member,fail='P0043');check('Morning never covers Evening',not checked(t))
t=create(fields(day='2026-12-13'));change(t,member,fail='P0043');check('current check-in cannot cover another meeting week',not checked(t))
t=create(fields(day='2026-12-27'));change(t,member,fail='P0038')
t=create(fields(day='2026-12-22'));check('off-day date never invents a check-in scope',not checked(t))
t=create(fields(day='2026-12-21'));check('following-day due date matches Sunday check-in',change(t,member)['status']=='completed')
# Reassignment cannot borrow the original assignee's check-in.
t=create(fields());reassigned=rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','update',{literal(fields(assignee=ownmember))},null,'this',null",owner)
change(reassigned,owner,fail='P0043');check('reassigned member needs their own check-in',fresh(reassigned)['status']=='active')
# Editor completion is guarded; ordinary metadata edits remain possible.
t=create(fields(assignee=cm));q=f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','update',{literal(fields(assignee=cm,status='completed'))},null,'this',null);"
sql(q,coord,'P0043');check('editor cannot bypass check-in',fresh(t)['status']=='active')
updated=rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','update',{literal(fields(assignee=cm,notes='Allowed metadata edit'))},null,'this',null",coord)
check('metadata edit does not need check-in',updated['notes']=='Allowed metadata edit')
checkin(coord);updated=change(updated,coord);check('checked editor assignee can complete',updated['status']=='completed')
sql(f"select public.task_app_has_completion_check_in(t,'{mm}',now())from public.tasks t where id='{t['id']}';",member,'42501')
sql(f"update public.tasks set status='completed'where id='{t['id']}';",member,'42501')
# A self-absence after check-in requires Check In again; manager restriction is not cleared.
t=create(fields());sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,sunday_service,created_at,expires_at)values('{owner}','{mm}','{categories['Sunday Service']}','morning','2026-12-20 09:00+05:30','2026-12-22 00:00+05:30');")
change(t,member,fail='P0403');check('self-absence invalidates prior check-in',not checked(t));checkin(member);check('return check-in clears self-absence and permits completion',change(t,member)['status']=='completed')
# Exact historical check-in permits late normal completion, never another occurrence.
clock('2026-12-27T10:00:00+05:30');old=create(fields());check('historical own check-in retained for dated overdue task',change(old,member)['status']=='completed')
new=create(fields(day='2026-12-27'));change(new,member,fail='P0043');checkin(member);check('new week needs its own check-in',change(new,member)['status']=='completed')
undated=create(fields(day=None));check('undated uses current category occurrence',change(undated,member)['status']=='completed')
clock('2026-12-29T10:00:00+05:30');undated=create(fields(day=None));change(undated,member,fail='P0038')
# Wrong category, actor, workspace and a fabricated future timestamp do not match.
clock('2026-12-23T20:00:00+05:30');heal=create(fields('Healing Meeting','2026-12-23'))
change(heal,member,fail='P0043');checkin(member,'Healing Meeting');check('Healing has its own date and category',change(heal,member)['status']=='completed')
rev=create(fields('Revival Meeting','2026-12-25'));check('Healing cannot qualify Revival',not checked(rev))
check('another actor check-in does not qualify',not checked(heal,ownmember))
othermember=rpc('task_app_member_state','',outsider)['current']['id'];check('another workspace cannot qualify',not checked(heal,othermember))
sql(f"update public.task_member_check_ins set checked_at='2026-12-24 00:00+05:30'where member_id='{mm}'and category_id='{categories['Healing Meeting']}';")
check('future timestamp cannot qualify',not checked(heal));sql(f"update public.task_member_check_ins set checked_at='2026-12-23 20:00+05:30'where member_id='{mm}'and category_id='{categories['Healing Meeting']}';")
# Missed requires the RECORDER's check-in, not the absent member's.
sql('select public.task_app_enable_fines();')
for user,m in[(coord,cm),(owner,ownmember)]:
 target=create(fields('Healing Meeting','2026-12-23'))
 before=rows();missed(target,user,fail='P0043');check('denied Missed rolls back fine absence credits notifications and task',before==rows())
 checkin(user,'Healing Meeting')
 sql(f"delete from public.task_member_check_ins where member_id='{mm}'and category_id='{categories['Healing Meeting']}';")
 result=missed(target,user);done=fresh(target)
 check('checked manager records Missed without assignee check-in',done['status']=='completed'and done['completed_by_member_id']==m and done['missed_completion_role']in('owner','coordinator'))
 check('Missed still issues immediate fine',int(sql(f"select count(*)from public.task_fines where task_id='{target['id']}';"))==1)
 sql(f"delete from public.task_member_check_ins where member_id='{m}'and category_id='{categories['Healing Meeting']}';")
 change(done,member,'active',fail='P0403');change(done,owner if user==coord else coord,'active',fail='P0403')
 fines=sql('select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f;')
 check('only recorded manager can reopen without check-in',change(done,user,'active')['status']=='active')
 check('reopening retains fines',fines==sql('select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f;'))
# Special Meeting exact event/day. Each daily occurrence needs its own check-in.
clock('2026-12-30T10:00:00+05:30')
special=create(fields('Special Meeting','2026-12-30',special_days=3,repeat_rule='daily'))
s=rpc('task_app_special_state','',owner);plan=next(p for p in s['plans']if p['id']==special['special_plan_id']);event=next(e for e in s['meetings']if e['id']==plan['meetingId'])
change(special,member,fail='P0038');rpc('task_app_set_special_locked',f"'{event['id']}','{event['version']}',false,true",owner)
sql(f"insert into public.task_member_check_ins(owner_id,member_id,category_id,meeting_date,checked_at)values('{owner}','{mm}','{categories['Special Meeting']}','2026-12-30','2026-12-30 09:00+05:30');")
change(fresh(special),member,fail='P0043');check('Special record for a different event scope cannot qualify',not checked(special));checkin(member,'Special Meeting');done=change(fresh(special),member);check('Special needs activated exact event check-in',done['status']=='completed')
clock('2026-12-31T10:00:00+05:30');sql(f"select public.task_app_release_repeats('{owner}',public.completion_test_now());")
next_task=json.loads(sql(f"select to_jsonb(t)from public.tasks t where special_plan_id='{special['special_plan_id']}'and due_date='2026-12-31';"))
change(next_task,member,fail='P0043');checkin(member,'Special Meeting');check('next Special day needs a new check-in',change(next_task,member)['status']=='completed')
clock('2027-01-02T10:00:00+05:30')
blank=create(fields('Special Meeting','2027-01-02'))
s=rpc('task_app_special_state','',owner);p=next(p for p in s['plans']if p['id']==blank['special_plan_id']);e=next(e for e in s['meetings']if e['id']==p['meetingId'])
rpc('task_app_set_special_locked',f"'{e['id']}','{e['version']}',false,true",owner);checkin(member,'Special Meeting')
clock('2027-01-03T10:00:00+05:30');check('blank duration uses original meeting day through following-day visibility',change(fresh(blank),member)['status']=='completed')
check('post-install read-only checks report no issues',sql((root/'supabase/verification/20261102_completion_check_in_checks.sql').read_text())=='')
check('trigger is enabled once after the meeting-start guard',sql("select count(*)from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_ab_completion_check_in'and tgenabled='O';")=='1')
print('PASS all043 check-in completion regressions',flush=True)
'''
exec(compile(source+'\n'+''.join(' '+line+'\n'for line in cases.strip().splitlines())+'\nfinally:\n subprocess.run(["docker","stop",container],stdout=subprocess.DEVNULL)\n',__file__,'exec'))
