#!/usr/bin/env python3
"""Absence permissions, deadlines, claims and repeat integration on disposable PostgreSQL only."""
from pathlib import Path
import subprocess,time,json,concurrent.futures
root=Path(__file__).resolve().parents[2]
container=subprocess.run(['docker','run','--pull=never','--rm','-d','--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine'],check=True,text=True,capture_output=True).stdout.strip()
users=[f'00000000-0000-4000-8000-{n:012}' for n in range(1,20)]
sessions={u:f'00000000-0000-4000-9000-{n:012}' for n,u in enumerate(users,1)}
owner,coord,member,outsider,wrong,unverified=users[:6]
def sql(query,user=None,fail=None):
 prefix='' if user is None else f"set request.jwt.claim.sub='{user}';set request.jwt.claim.session_id='{sessions[user]}';set role authenticated;"
 result=subprocess.run(['docker','exec','-i',container,'psql','-X','-q','-At','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=prefix+query,text=True,capture_output=True)
 if fail:
  assert result.returncode!=0 and fail in result.stderr,(fail,result.stdout,result.stderr);return
 assert result.returncode==0,result.stderr
 return result.stdout.strip()
def literal(value):return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
def rpc(name,args,user):return json.loads(sql(f'select public.{name}({args});',user))
def expect(name,query,user,code):sql(query,user,code);print('PASS',name,flush=True)
def check(name,condition):assert condition,name;print('PASS',name,flush=True)
try:
 for i in range(40):
  if subprocess.run(['docker','exec',container,'psql','-X','-q','-At','-U','postgres','-c','select 1'],capture_output=True).returncode==0:
   time.sleep(.6)
   if subprocess.run(['docker','exec',container,'psql','-X','-q','-At','-U','postgres','-c','select 1'],capture_output=True).returncode==0:break
  time.sleep(.25)
 sql((root/'supabase/tests/local-bootstrap.sql').read_text())
 sql("alter table auth.users add column email text,add column email_confirmed_at timestamptz,add column banned_until timestamptz;create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,not_after timestamptz);create function auth.jwt()returns jsonb language sql stable as $$select jsonb_build_object('sub',auth.uid(),'session_id',nullif(current_setting('request.jwt.claim.session_id',true),''))$$;grant execute on function auth.jwt()to anon,authenticated;")
 sql((root/'supabase/tests/local-realtime-bootstrap.sql').read_text())
 for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())
 for n,u in enumerate(users,1):sql(f"insert into auth.users(id,email,email_confirmed_at)values('{u}','person{n}@example.test',{'null' if u==unverified else 'now()'});insert into auth.sessions(id,user_id) values('{sessions[u]}','{u}');")
 sql(f"select public.task_app_bootstrap_workspace('{owner}','Jerin');select public.task_app_bootstrap_workspace('{outsider}','Other Owner');")
 om=rpc('task_app_member_state','',owner)['current']['id']
 def join(user,n,name,role='member'):
  invitation=rpc('task_app_invite',f"'person{n}@example.test','{role}',null",owner)
  return rpc('task_app_accept_invitation',f"'{invitation['token']}','{name}'",user)['current']['id']
 cm=join(coord,2,'Daniel','coordinator');mm=join(member,3,'Sarah');hm=join(wrong,5,'Helper')
 rpc('task_app_setup',"'bootstrap',null",owner)
 cats={v['name']:v['id'] for v in json.loads(sql(f"select jsonb_agg(jsonb_build_object('id',id,'name',name))from public.categories where owner_id='{owner}';"))}
 category=cats['Healing Meeting'];special=cats['Special Meeting']
 fields={'title':'Prepare sound','notes':'Fictional coverage test','status':'active','due_date':None,'due_time':None,'priority':'medium','category_id':category,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
 def create(**overrides):return rpc('task_app_create_tasks',literal([{**fields,**overrides}]),owner)[0]
 def take(t,a,user=wrong,fail=None,version=None,confirmed=True):
  query=f"select public.task_app_take_task('{t['id']}','{version or t['updated_at']}','{a}',{str(confirmed).lower()});"
  if fail:return expect('claim denied '+fail,query,user,fail)
  return json.loads(sql(query,user))
 def status(t,value,user,fail=None):
  query=f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','status',null,'{value}','this',null);"
  if fail:return expect('status denied '+fail,query,user,fail)
  return json.loads(sql(query,user))
 expect('absence requires verified identity',f"select public.task_app_mark_absent('{category}',null,true);",unverified,'P0403')
 expect('absence requires workspace',f"select public.task_app_mark_absent('{category}',null,true);",users[6],'P0403')
 expect('cannot mark another workspace category',f"select public.task_app_mark_absent('{category}',null,true);",outsider,'23514')
 expect('explicit confirmation required',f"select public.task_app_mark_absent('{category}',null,false);",member,'23514')
 expect('Special Meeting date required',f"select public.task_app_mark_absent('{special}',null,true);",member,'23514')
 expect('Special Meeting rejects unrepresentable expiry',f"select public.task_app_mark_absent('{special}','infinity'::date,true);",member,'23514')
 expect('Special Meeting rejects overflow year',f"select public.task_app_mark_absent('{special}','9999-12-31',true);",member,'23514')
 expect('weekly category rejects supplied date',f"select public.task_app_mark_absent('{category}',current_date,true);",member,'23514')
 expect('expired Special Meeting rejected',f"select public.task_app_mark_absent('{special}',current_date-5,true);",member,'P0409')
 for table in ['account_member_absences','task_coverage_claims']:
  expect('private attendance table '+table,f'select * from public.{table};',owner,'42501')
  expect('no direct attendance mutation '+table,f'delete from public.{table};',member,'42501')
 check('clock helper not exposed',sql("select has_function_privilege('authenticated','public.task_app_absence_covers(public.tasks,public.account_member_absences,timestamptz)','execute');")=='f')
 t=create();untouched=create(assigned_to_member_id=om);completed=create();completed=status(completed,'completed',member)
 state=rpc('task_app_mark_absent',f"'{category}',null,true",member);a=state['absences'][0]
 check('absence derives member and workspace identity',a['member_id']==mm and a['category_id']==category and a['meeting_date']is None and state['current']['id']==mm)
 check('weekly absence deadline matches history',sql(f"select expires_at=public.task_app_history_expires('Healing Meeting',created_at,null,'{{}}') from public.account_member_absences where id='{a['id']}';")=='t')
 retry=rpc('task_app_mark_absent',f"'{category}',null,true",member)
 check('absence retry idempotent',len(retry['absences'])==1 and retry['absences'][0]['id']==a['id'])
 check('all workspace members see absence but other workspace does not',len(rpc('task_app_member_state','',wrong)['absences'])==1 and rpc('task_app_member_state','',outsider)['absences']==[])
 available=rpc('task_app_available_coverage','',wrong)
 check('only unfinished absent assignee released',len(available)==1 and available[0]['task_id']==t['id'] and available[0]['version']==t['updated_at'])
 status(t,'completed',member,'P0403');status(t,'completed',owner,'P0403')
 take(t,a['id'],member,fail='P0403');take(t,a['id'],wrong,fail='23514',confirmed=False)
 take(t,a['id'],outsider,fail='P0409');take(t,a['id'],wrong,fail='P0409',version='2020-01-01T00:00:00Z')
 take(untouched,a['id'],wrong,fail='P0409');take(completed,a['id'],wrong,fail='P0409')
 rpc('task_app_mark_absent',f"'{category}',null,true",coord)
 take(t,a['id'],coord,fail='P0403')
 before=sql(f"select coalesce(sum(completed_count),0) from public.member_completion_totals where member_id='{hm}';")
 expect('origin read requires verified email',"select public.task_app_coverage_origins();",unverified,'P0403')
 expect('origin read requires workspace',"select public.task_app_coverage_origins();",users[6],'P0403')
 check('anonymous cannot execute origin read',sql("select has_function_privilege('anon','public.task_app_coverage_origins()','execute');")=='f')
 claimed=take(t,a['id'])
 def origin_for(task_id,user=wrong):return next((entry for entry in rpc('task_app_coverage_origins','',user)if entry['task_id']==task_id),None)
 origin=origin_for(t['id'])
 check('original assignment readable with exact task version',origin['member_id']==mm and origin['member_name']=='Sarah'and origin['taken_by_member_id']==hm and origin['version']==claimed['updated_at'])
 check('origin read is scoped to the verified workspace',rpc('task_app_coverage_origins','',outsider)==[])
 check('unclaimed normal task has no provenance',origin_for(untouched['id'])is None)
 check('Member takes one task without normal edit rights',claimed['assigned_to_member_id']==hm and claimed['coverage']is None and claimed['status']=='active')
 check('taking does not award completion credit',sql(f"select coalesce(sum(completed_count),0) from public.member_completion_totals where member_id='{hm}';")==before)
 check('claim retry idempotent',take(t,a['id'])['updated_at']==claimed['updated_at'])
 take(t,a['id'],owner,fail='P0409')
 status(claimed,'completed',member,'P0403');status(claimed,'completed',owner,'P0403')
 done=status(claimed,'completed',wrong)
 check('completion keeps original assignment with current version',origin_for(t['id'])['member_id']==mm and origin_for(t['id'])['version']==done['updated_at'])
 check('real helper is completion author',done['completed_by_member_id']==hm and done['completed_by_name']=='Helper')
 status(done,'active',member,'P0403');status(done,'active',owner,'P0403')
 reopened=status(done,'active',wrong)
 check('reopen preserves provenance and actual helper assignment',origin_for(t['id'])['member_id']==mm and reopened['assigned_to_member_id']==hm)
 check('helper can reopen and loses yearly credit',reopened['status']=='active'and sql(f"select completed_count from public.member_completion_totals where member_id='{hm}';")=='0')
 expect('claim does not grant general editing',f"select public.task_app_mutate('{reopened['id']}','{reopened['updated_at']}','update',{literal({**fields,'assigned_to_member_id':hm})},null,'this',null);",wrong,'P0403')
 expect('claim does not grant Bin deletion',f"select public.task_app_mutate('{reopened['id']}','{reopened['updated_at']}','delete',null,null,'this',null);",wrong,'P0403')
 expect('claim does not grant templates',"select public.task_app_deleted_templates();",wrong,'P0403')
 # Real concurrent contenders: a Member and Owner, exactly one can claim.
 race=create(title='Race task')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  def contender(u):
   try:return take(race,a['id'],u)
   except AssertionError as e:return str(e)
  results=list(pool.map(contender,[owner,wrong]))
 check('concurrent claims have exactly one winner',sum(isinstance(r,dict) for r in results)==1 and sql(f"select count(*)from public.task_coverage_claims where task_id='{race['id']}';")=='1')
 # Claim an actual daily repeat; its queued successor and series retain original assignment.
 today=sql("select (statement_timestamp()at time zone 'Asia/Kolkata')::date;")
 repeat=create(title='Repeated sound check',due_date=today,due_time='23:50',repeat_rule='daily')
 # Test via same category with future deadline; never alter the server clock.
 sql(f"update public.account_member_absences set expires_at=now()+interval '8 days'where id='{a['id']}';")
 repeat_claim=take(repeat,a['id'],wrong);repeat_done=status(repeat_claim,'completed',wrong)
 check('repeat claim leaves original series assignment',sql(f"select assigned_to_member_id from public.task_series where id='{repeat['series_id']}';")==mm)
 check('next pending occurrence keeps original series assignee',sql(f"select s.assigned_to_member_id from public.task_repeat_pending p join public.task_series s on s.id=p.series_id where p.series_id='{repeat['series_id']}';")==mm)
 sql(f"select public.task_app_release_repeats('{owner}',(select (due_date+time '00:00')at time zone 'Asia/Kolkata'from public.task_repeat_pending where series_id='{repeat['series_id']}'));")
 check('generated next occurrence assigned to original person',sql(f"select assigned_to_member_id from public.tasks where series_id='{repeat['series_id']}'and occurrence_number=1;")==mm)
 check('future repeat occurrence does not inherit claim provenance',sql(f"select count(*)from public.tasks t cross join lateral jsonb_array_elements(public.task_app_coverage_origins())j where t.series_id='{repeat['series_id']}'and t.occurrence_number=1 and j->>'task_id'=t.id::text;",wrong)=='0')
 # Exact category boundaries are tested using the PRIVATE helper as postgres.
 def covers(task_changes=None,absence_changes=None,at='2026-10-12T18:29:59Z'):
  fixture={**t,'due_date':'2026-10-11','due_time':'23:50:00','created_at':'2026-10-10T00:00:00Z',**(task_changes or {})}
  absence={**a,'owner_id':owner,'category_id':category,'created_at':'2026-10-10T00:00:00Z','expires_at':'2026-10-15T18:30:00Z',**(absence_changes or {})}
  return sql(f"select public.task_app_absence_covers(jsonb_populate_record(null::public.tasks,{literal(fixture)}),jsonb_populate_record(null::public.account_member_absences,{literal(absence)}),'{at}');")=='t'
 check('current overdue work eligible',covers())
 check('absence expires at exact India deadline',not covers(at='2026-10-15T18:30:00Z'))
 check('future period excluded',not covers({'due_date':'2026-10-21'}))
 check('old overdue period excluded',not covers({'due_date':'2026-10-02','created_at':'2026-10-01T00:00:00Z'}))
 check('completed/deleted/unavailable excluded',all(not covers(change)for change in [{'status':'completed'},{'deleted_at':'2026-10-12T00:00:00Z'},{'available_at':'2026-10-14T00:00:00Z'}]))
 check('undated current work eligible',covers({'due_date':None,'due_time':None}))
 check('due exactly on reset belongs to expiring period',not covers({'due_date':'2026-10-15','due_time':None},{'expires_at':'2026-10-22T18:30:00Z'},at='2026-10-15T18:30:01Z'))
 check('category mismatch excluded',not covers({'category_id':special}))
 special_date=today
 special_state=rpc('task_app_mark_absent',f"'{special}','{special_date}',true",member)
 sa=next(v for v in special_state['absences']if v['category_id']==special)
 check('Special selected date includes all of the next day',sql(f"select expires_at=((meeting_date+2)+time '00:00')at time zone 'Asia/Kolkata'from public.account_member_absences where id='{sa['id']}';")=='t')
 expect('cannot change active Special date',f"select public.task_app_mark_absent('{special}',(statement_timestamp()at time zone 'Asia/Kolkata')::date+1,true);",member,'P0409')
 check('Special date match only',covers({'category_id':special,'due_date':'2026-10-12'},{'category_id':special,'meeting_date':'2026-10-12'})and not covers({'category_id':special,'due_date':'2026-10-13'},{'category_id':special,'meeting_date':'2026-10-12'}))
 expiry_task=create(title='Expires before claim')
 sql(f"update public.account_member_absences set created_at=now()-interval '1 day',expires_at=now()-interval '1 second'where id='{a['id']}';")
 take(expiry_task,a['id'],wrong,fail='P0409')
 check('expired absence disappears without deleting task or claimed assignment',all(v['id']!=a['id']for v in rpc('task_app_member_state','',member)['absences'])and sql(f"select assigned_to_member_id from public.tasks where id='{claimed['id']}';")==hm and sql(f"select count(*)from public.tasks where id='{expiry_task['id']}'and deleted_at is null;")=='1')
 status(expiry_task,'completed',member)
 check('absence expiry does not erase taken task original assignee',origin_for(t['id'])['member_name']=='Sarah')
 # A normal reassignment away no longer displays an earlier claim's source.
 reassigned=rpc('task_app_mutate',f"'{reopened['id']}','{reopened['updated_at']}','update',{literal({**fields,'assigned_to_member_id':om})},null,'this',null",owner)
 check('normal reassignment away clears display provenance',reassigned['assigned_to_member_id']==om and origin_for(t['id'])is None)
 # Source name stays available even if the original member subsequently leaves.
 sql(f"update public.account_members set left_at=now()where id='{mm}';")
 check('departed original member retains claim name',origin_for(repeat['id'])['member_name']=='Sarah')
 check('legacy helpers remain private' ,sql("select count(*)from pg_proc where pronamespace='public'::regnamespace and proname like 'task_app_legacy_%'and has_function_privilege('authenticated',oid,'execute');")=='0')
 verification=sql((root/'supabase/verification/20261014_absence_coverage_schema_checks.sql').read_text())
 check('absence schema security verification',all(line.split('|')[1]=='0'for line in verification.splitlines()))
 verification=sql((root/'supabase/verification/20261014_coverage_original_assignee_checks.sql').read_text())
 check('original-assignee schema security verification',all(line.split('|')[1]=='0'for line in verification.splitlines()))
 print('All isolated absence integration checks passed.',flush=True)
finally:subprocess.run(['docker','rm','-f',container],capture_output=True)
