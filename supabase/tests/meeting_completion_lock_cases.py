rpc('task_app_setup',"'bootstrap',null",owner)
categories=json.loads(sql(f"select jsonb_object_agg(name,id)from public.categories where owner_id='{owner}';"))
def fields(category='Sunday Service',day='2026-12-20',assignee=mm,**extra):
 return {'title':'Fictional meeting task','notes':'Preserve edits','status':'active','due_date':day,'due_time':'23:50'if day else None,'priority':'medium','category_id':categories[category],'weekdays':[],'repeat_rule':'off','assigned_to_member_id':assignee,**extra}
def create(f):return rpc('task_app_create_tasks',literal([f]),owner)[0]
def fresh(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def change(t,user,status='completed',fail=None):
 q=f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','status',null,'{status}');"
 if fail:return sql(q,user,fail)
 return json.loads(sql(q,user))
tasks=[(create(fields(assignee=m)),u,m)for u,m in[(owner,ownmember),(coord,cm),(member,mm)]]
old=create(fields(assignee=ownmember));old=change(old,owner)
snapshot=sql("select md5(jsonb_agg(to_jsonb(t)order by id)::text)from public.tasks t;")
security=sql("select md5(jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relacl)order by c.relname)::text)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind='r';")
functions=sql("select md5(jsonb_agg(jsonb_build_array(oid::regprocedure::text,prosrc,proacl)order by oid::regprocedure::text)::text)from pg_proc where pronamespace='public'::regnamespace and prokind='f';")
# Record installed function definitions/access before038, then compare only them.
sql("create table public.test_old_function_snapshot as select oid,prosrc,proacl from pg_proc where pronamespace='public'::regnamespace and prokind='f';")
sql((root/'supabase/migrations/202610180038_meeting_completion_lock.sql').read_text())
check('038 preserves table access and RLS',security==sql("select md5(jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relacl)order by c.relname)::text)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind='r'and c.relname<>'test_old_function_snapshot';"))
check('038 preserves every historical task row',snapshot==sql("select md5(jsonb_agg(to_jsonb(t)order by id)::text)from public.tasks t;"))
check('038 preserves all existing function bodies and ACLs',sql("select count(*)from public.test_old_function_snapshot s join pg_proc p using(oid)where p.prosrc is distinct from s.prosrc or p.proacl is distinct from s.proacl;")=='0')
check('new private helpers expose no client execution',sql("select bool_and(not has_function_privilege('authenticated',oid,'execute')and not has_function_privilege('anon',oid,'execute')and not has_function_privilege('service_role',oid,'execute'))from pg_proc where pronamespace='public'::regnamespace and proname in('task_app_completion_open','task_app_guard_completion_start');")=='t')
sql((root/'supabase/migrations/202610180038_meeting_completion_lock.sql').read_text(),fail='already installed; do not replay')

# Only this disposable database uses a controlled clock. Production functions
# retain clock_timestamp(), with all permissions and locking paths intact.
sql("create table public.meeting_lock_test_clock(at_time timestamptz);insert into public.meeting_lock_test_clock values('2026-12-19T23:59:59.999+05:30');create function public.meeting_lock_test_now()returns timestamptz language sql stable security definer set search_path=''as $$select at_time from public.meeting_lock_test_clock$$;revoke all on public.meeting_lock_test_clock from public,anon,authenticated,service_role;revoke all on function public.meeting_lock_test_now()from public,anon,authenticated,service_role;")
import re
definitions=json.loads(sql("select jsonb_agg(pg_get_functiondef(oid))from pg_proc where pronamespace='public'::regnamespace and prokind='f'and proname<>'meeting_lock_test_now'and(prosrc like '%clock_timestamp()%'or prosrc like '%statement_timestamp()%'or prosrc like '%now()%');"))
for definition in definitions:
 definition=re.sub(r'(?<![\w.])now\(\)','public.meeting_lock_test_now()',definition)
 sql(definition.replace('clock_timestamp()','public.meeting_lock_test_now()').replace('statement_timestamp()','public.meeting_lock_test_now()'))
def clock(value):sql(f"update public.meeting_lock_test_clock set at_time='{value}';")
for t,user,m in tasks:
 change(t,user,fail='P0038')
 check('future completion blocked for '+('Owner'if user==owner else 'Coordinator'if user==coord else 'Member'),fresh(t)['status']=='active')
 if user!=member:
  f=fields(assignee=m,notes='Manager can edit while locked')
  t=rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','update',{literal(f)},null,'this',null",user)
  check('manager metadata edit remains allowed',t['notes']=='Manager can edit while locked'and t['status']=='active')
  sql(f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','update',{literal({**f,'status':'completed'})},null,'this',null);",user,fail='P0038')
sql(f"update public.tasks set status='completed'where id='{tasks[2][0]['id']}';",fail='P0038')
sql(f"insert into public.tasks(owner_id,title,status,priority,category_id,due_date,weekdays,assigned_to_member_id)values('{owner}','Privileged future insert','completed','medium','{categories['Sunday Service']}','2026-12-20','{{}}','{ownmember}');",fail='P0038')
check('privileged inserts and updates cannot bypass the status guard',sql("select count(*)from public.tasks where title='Privileged future insert';")=='0')
check('blocked updates leave completion credits and fines unchanged',sql(f"select count(*)from public.member_task_completions where task_id in('{tasks[0][0]['id']}','{tasks[1][0]['id']}','{tasks[2][0]['id']}');")=='0'and sql('select count(*)from public.task_fines;')=='0')
old=rpc('task_app_mutate',f"'{old['id']}','{old['updated_at']}','update',{literal(fields(assignee=ownmember,status='completed',notes='Historical completion edit'))},null,'this',null",owner)
check('editing existing completed records is not blocked or rewritten',old['status']=='completed'and old['notes']=='Historical completion edit')
old=change(old,owner,'active');change(old,owner,fail='P0038')
clock('2026-12-20T00:00:00+05:30')
check('following-day dates use the original meeting start',sql(f"select public.task_app_completion_open(jsonb_populate_record(t,jsonb_build_object('due_date','2026-12-21')),public.meeting_lock_test_now())from public.tasks t where id='{tasks[0][0]['id']}';")=='t')
check('off-day dates are never mapped to a prior open meeting',sql(f"select public.task_app_completion_open(jsonb_populate_record(t,jsonb_build_object('due_date','2026-12-22')),public.meeting_lock_test_now())from public.tasks t where id='{tasks[0][0]['id']}';")=='f')
for t,user,m in tasks:
 done=change(fresh(t),user);check('exact start allows own completion for '+user,done['status']=='completed'and done['completed_by_member_id']==m)
other=create(fields());sql(f"select public.task_app_mutate('{other['id']}','{other['updated_at']}','status',null,'completed');",coord,fail='P0403')
for category,start,ends in [('Healing Meeting','2026-12-23','2026-12-25'),('Revival Meeting','2026-12-25','2026-12-27')]:
 t=create(fields(category,start));clock(start+'T00:00:00+05:30');check(category+' opens at midnight',change(t,member)['status']=='completed')
 undated=create(fields(category,None));clock(ends+'T00:00:00+05:30');change(undated,member,fail='P0038')
 check(category+' undated closes at end of its window',fresh(undated)['status']=='active')
past=create(fields('Sunday Service','2026-12-13'));check('past dated overdue task remains completable',change(past,member)['status']=='completed')
future=create(fields('Sunday Service','2026-12-27'));clock('2026-12-20T20:00:00+05:30');change(future,member,fail='P0038')
sql(f"select public.task_app_complete_missed('{future['id']}','{future['updated_at']}',true);",coord,fail='P0014')
check('future Missed remains blocked without issuing a fine',fresh(future)['status']=='active'and sql('select count(*)from public.task_fines;')=='0')
special=create(fields('Special Meeting','2026-12-21',special_days=3,repeat_rule='daily'))
state=rpc('task_app_special_state','',owner);plan=next(p for p in state['plans']if p['id']==special['special_plan_id']);event=next(e for e in state['meetings']if e['id']==plan['meetingId'])
sql(f"select public.task_app_mutate('{special['id']}','{special['updated_at']}','status',null,'completed');",member,fail='P0038')
rpc('task_app_set_special_locked',f"'{event['id']}','{event['version']}',false,true",coord)
check('activation still cannot start tomorrow early',sql(f"select public.task_app_completion_open(t,public.meeting_lock_test_now())from public.tasks t where id='{special['id']}';")=='f')
clock('2026-12-21T00:00:00+05:30');check('activated Special opens on its saved start',change(fresh(special),member)['status']=='completed')
check('Special daily occurrences cannot complete on a previous day',sql(f"select public.task_app_completion_open(jsonb_populate_record(t,jsonb_build_object('due_date','2026-12-22')),public.meeting_lock_test_now())from public.tasks t where id='{special['id']}';")=='f')
sql(f"select public.task_app_completion_open(t,clock_timestamp())from public.tasks t where id='{special['id']}';",member,fail='42501')
check('current trigger exists exactly once',sql("select count(*)from pg_trigger where tgname='tasks_aa_meeting_completion_start'and tgenabled='O';")=='1')
check('read-only post-install verification reports no issues',sql((root/'supabase/verification/20261018_meeting_completion_lock_checks.sql').read_text())=='')
print('PASS all038 local server-lock checks',flush=True)
