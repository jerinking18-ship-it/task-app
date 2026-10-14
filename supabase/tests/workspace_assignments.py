#!/usr/bin/env python3
"""Isolated PostgreSQL integration tests; never connects to hosted Supabase."""
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
 sql(f"insert into public.account_members(owner_id,name)values('{owner}','Existing Owner Name');insert into public.tasks(id,owner_id,title,notes,status,priority,weekdays)values('00000000-0000-4000-8000-000000000811','{owner}','Preserved existing task','Keep this note','active','medium','{{}}');")
 legacy_created=sql("select created_at from public.tasks where id='00000000-0000-4000-8000-000000000811';")
 sql(f"select public.task_app_bootstrap_workspace('{owner}','Jerin');select public.task_app_bootstrap_workspace('{outsider}','Other Owner');")
 state=rpc('task_app_member_state','',owner);ownmember=state['current']['id']
 check('bootstrap preserves existing profile name',state['current']['name']=='Existing Owner Name')
 check('bootstrap preserves and assigns existing task',sql(f"select count(*)from public.tasks where id='00000000-0000-4000-8000-000000000811'and title='Preserved existing task'and notes='Keep this note'and status='active'and assigned_to_member_id='{ownmember}'and created_at='{legacy_created}';")=='1')
 def invite(n,role='member',user=owner):return rpc('task_app_invite',f"'person{n}@example.test','{role}',null",user)
 ci=invite(2,'coordinator');mi=invite(3)
 cs=rpc('task_app_accept_invitation',f"'{ci['token']}','Daniel'",coord);cm=cs['current']['id']
 ms=rpc('task_app_accept_invitation',f"'{mi['token']}','Sarah'",member);mm=ms['current']['id']
 check('personal identities share workspace',cs['workspace']['owner_id']==owner and ms['current']['role']=='member' and len(ms['members'])==3)
 sql(f"update auth.sessions set not_after=now()-interval '1 second'where id='{sessions[member]}';")
 expect('expired Auth session rejected even with stale JWT','select public.task_app_member_state();',member,'42501')
 sql(f"update auth.sessions set not_after=null where id='{sessions[member]}';update auth.users set banned_until=now()+interval '1 day'where id='{member}';")
 expect('banned Auth identity rejected even with stale JWT','select public.task_app_member_state();',member,'42501')
 sql(f"update auth.users set banned_until=null where id='{member}';")

 expect('no profile impersonation',f"select public.task_app_choose_member('{ownmember}',null);",member,'42501')
 expect('bootstrap admin-only',f"select public.task_app_bootstrap_workspace('{member}','Fake Owner');",member,'42501')
 expect('identity association private','select auth_user_id from public.account_members;',member,'42501')
 expect('unverified email rejected','select public.task_app_member_state();',unverified,'42501')
 rpc('task_app_setup',"'bootstrap',null",member)
 today=sql("select (statement_timestamp()at time zone 'Asia/Kolkata')::date;")
 category=sql(f"select id from public.categories where owner_id='{owner}' and name='Sunday Service';")
 fields={'title':'Prepare service','notes':'Fictional integration task','status':'active','due_date':today,'due_time':'23:50','priority':'medium','category_id':category,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
 t=rpc('task_app_create_tasks',literal([fields]),owner)[0]
 def mutate(task,operation,user,fields=None,status=None,scope='this',fail=None):
  args=f"'{task['id']}','{task['updated_at']}','{operation}',{literal(fields) if fields else 'null'},{repr(status) if status else 'null'},'{scope}','{task['updated_at']}'"
  if fail:return expect(f'{operation} permission denied',f'select public.task_app_mutate({args});',user,fail)
  return rpc('task_app_mutate',args,user)
 expect('required assignee',f"select public.task_app_create_tasks({literal([{**fields,'assigned_to_member_id':None}])});",owner,'23514')
 expect('Member cannot create',f"select public.task_app_create_tasks({literal([fields])});",member,'P0403')
 expect('direct INSERT denied',"insert into public.tasks(title)values('Bypass');",owner,'42501')
 expect('direct UPDATE denied',f"update public.tasks set status='completed'where id='{t['id']}';",member,'42501')
 expect('legacy mutation private',f"select public.task_app_legacy_mutate('{t['id']}','{t['updated_at']}','status',null,'completed','this',null);",owner,'42501')
 check('cross-workspace reads empty',sql(f"select count(*)from public.tasks where owner_id='{owner}';",outsider)=='0')
 mutate(t,'status',owner,status='completed',fail='P0403');mutate(t,'status',coord,status='completed',fail='P0403')
 done=mutate(t,'status',member,status='completed');check('assignee completes with attribution',done['status']=='completed'and done['completed_by_member_id']==mm)
 mutate(done,'update',owner,fields={**fields,'status':'completed','assigned_to_member_id':cm},fail='P0409')
 mutate(done,'status',owner,status='active',fail='P0403')
 active=mutate(done,'status',member,status='active')
 check('reopen reduces yearly credit',sql(f"select completed_count from public.member_completion_totals where member_id='{mm}';")=='0')
 reassigned=mutate(active,'update',coord,fields={**fields,'assigned_to_member_id':cm})
 check('unfinished reassignment works',reassigned['assigned_to_member_id']==cm)
 mutate(reassigned,'status',member,status='completed',fail='P0403')
 stale=mutate(active,'status',member,status='completed');check('stale version does not change task',stale.get('conflict')is True)
 done2=mutate(reassigned,'status',coord,status='completed')
 check('recompletion keeps first occurrence credit once',sql(f"select completed_count from public.member_completion_totals where member_id='{mm}';")=='1' and sql(f"select coalesce(sum(completed_count),0) from public.member_completion_totals where member_id='{cm}';")=='0')
 expect('Member cannot edit',f"select public.task_app_mutate('{done2['id']}','{done2['updated_at']}','update',{literal(fields)},null,'this',null);",member,'P0403')
 expect('Member cannot clear completed',"select public.task_app_completed('preview',null,null,false);",member,'P0403')
 expect('Member cannot read templates',"select public.task_app_deleted_templates();",member,'P0403')
 expect('Member cannot save templates',f"select public.task_app_save_template('{users[10]}',null,'Test','[{{\"title\":\"A\",\"notes\":\"\"}}]');",member,'P0403')
 expect('Member cannot move to Bin',f"select public.task_app_mutate('{done2['id']}','{done2['updated_at']}','delete',null,null,'this',null);",member,'P0403')
 expect('Member cannot restore Bin',"select public.task_app_bin('restore','[]',true);",member,'P0403')
 moved=mutate(done2,'delete',coord);check('Coordinator moves to Bin',moved['deleted_at']is not None)
 check('Member sees read-only task Bin',sql('select count(*)from public.tasks where deleted_at is not null;',member)=='1')
 restored=rpc('task_app_bin',f"'restore',{literal([{'id':moved['id'],'version':moved['updated_at']}])},true",owner)
 check('Owner restores task',restored['action']=='restore')
 repeat=rpc('task_app_create_tasks',literal([{**fields,'title':'Repeat test','repeat_rule':'daily'}]),owner)[0]
 repeat=mutate(repeat,'update',coord,fields={**fields,'title':'Repeat test','repeat_rule':'daily','assigned_to_member_id':cm},scope='future')
 check('one occurrence leaves series assignment',sql(f"select assigned_to_member_id from public.task_series where id='{repeat['series_id']}';")==mm)
 repeat=mutate(repeat,'status',coord,status='completed')
 check('completion queues without early successor',sql(f"select count(*)from public.tasks where series_id='{repeat['series_id']}';")=='1')
 sql(f"select public.task_app_release_repeats('{owner}',statement_timestamp()+interval '2 days');")
 check('worker inherits original series assignee',sql(f"select assigned_to_member_id from public.tasks where series_id='{repeat['series_id']}'and occurrence_number=1;")==mm)
 # Restoring a stopped series resumes its original assignee, even after a
 # one-occurrence reassignment; permanent completed clear preserves that queue.
 restored_source=rpc('task_app_create_tasks',literal([{**fields,'title':'Restore repeat','repeat_rule':'daily'}]),owner)[0]
 restored_source=mutate(restored_source,'update',coord,fields={**fields,'title':'Restore repeat','repeat_rule':'daily','assigned_to_member_id':cm})
 restored_source=mutate(restored_source,'status',coord,status='completed')
 original_series=restored_source['series_id']
 moved_source=mutate(restored_source,'delete',owner)
 check('Bin move cancels pending repeats',sql(f"select count(*)from public.task_repeat_pending where series_id='{original_series}'and not cancelled and generated_at is null;")=='0')
 rpc('task_app_bin',f"'restore',{literal([{'id':moved_source['id'],'version':moved_source['updated_at']}])},true",coord)
 resumed_series=sql(f"select series_id from public.tasks where id='{moved_source['id']}';")
 check('restore preserves original series assignee',sql(f"select assigned_to_member_id from public.task_series where id='{resumed_series}';")==mm)
 snapshot=rpc('task_app_completed',"'preview',null,null,false",owner)
 rpc('task_app_completed',f"'purge',{snapshot['count']},'{snapshot['snapshot']}',true",coord)
 check('completed purge preserves detached assigned successor',sql(f"select count(*)from public.task_repeat_pending p join public.task_series s on s.id=p.series_id where p.series_id='{resumed_series}'and not p.cancelled and p.generated_at is null and p.source_task_id is null and s.assigned_to_member_id='{mm}';")=='1')
 # Template permissions are workspace-wide for managers and denied to Members.
 template_id=users[10]
 rpc('task_app_save_template',f"'{template_id}',null,'Meeting checklist',{literal([{'title':'Arrange chairs','notes':'Rows of ten'}])}",coord)
 check('Member direct template read is empty',sql('select count(*)from public.task_templates;',member)=='0')
 check('Coordinator direct template read is shared',sql('select count(*)from public.task_templates;',coord)=='1')
 before_version=sql(f"select updated_at from public.task_templates where id='{template_id}';")
 removed_template=rpc('task_app_remove_template',f"'{template_id}','{before_version}',true",owner)
 rpc('task_app_bin_items',f"'restore',{literal([{'kind':'template','id':template_id,'version':removed_template['updated_at']}])},true",coord)
 check('Coordinator restores template',sql(f"select count(*)from public.task_templates where id='{template_id}'and deleted_at is null;")=='1')
 # Same identity accepting twice concurrently consumes one reserved place only.
 concurrent_invite=invite(15)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  joined=list(pool.map(lambda _:rpc('task_app_accept_invitation',f"'{concurrent_invite['token']}','Concurrent member'",users[14]),range(2)))
 check('concurrent acceptance creates one member',joined[0]['current']['id']==joined[1]['current']['id'] and sql(f"select count(*)from public.account_members where auth_user_id='{users[14]}'and left_at is null;")=='1')
 expect('Coordinator cannot invite',"select public.task_app_invite('new@example.test','member',null);",coord,'P0403')
 expect('Coordinator cannot change roles',f"select public.task_app_change_role('{mm}','member','coordinator',true);",coord,'P0403')
 inv=invite(5)
 expect('forwarded invite cannot join wrong email',f"select public.task_app_accept_invitation('{inv['token']}','Wrong');",users[6],'P0403')
 accepted=rpc('task_app_accept_invitation',f"'{inv['token']}','New member'",wrong)
 check('acceptance converts reservation',accepted['current']['role']=='member'and accepted['workspace']['reserved_seats']==0)
 check('acceptance retry idempotent',rpc('task_app_accept_invitation',f"'{inv['token']}','Retry'",wrong)['current']['id']==accepted['current']['id'])
 expired=invite(7);sql(f"update public.workspace_invitations set expires_at=now()-interval '1 second'where id='{expired['id']}';")
 expect('expired invitation rejected',f"select public.task_app_accept_invitation('{expired['token']}','Late');",users[6],'P0409')
 for n in range(8,12):invite(n)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  def last(n):
   try:return invite(n)
   except AssertionError as e:return str(e)
  results=list(pool.map(last,[13,14]))
 check('concurrent invitations stop at ten places',sum(isinstance(r,dict)for r in results)==1 and sql(f"select (select count(*)from public.account_members where owner_id='{owner}'and left_at is null)+(select count(*)from public.workspace_invitations where owner_id='{owner}'and accepted_at is null and revoked_at is null and expires_at>now());")=='10')
 reserve=rpc('task_app_member_state','',owner)['invitations'][0];rpc('task_app_revoke_invitation',f"'{reserve['id']}'",owner)
 check('cancellation releases place',rpc('task_app_member_state','',owner)['workspace']['reserved_seats']==4)
 rpc('task_app_change_role',f"'{cm}','coordinator','member',true",owner)
 expect('stale demoted session denied',f"select public.task_app_create_tasks({literal([fields])});",coord,'P0403')
 expect('Owner must transfer before leave',"select public.task_app_leave_member();",owner,'P0409')
 transfer=rpc('task_app_transfer_owner',f"'{cm}',true",owner)
 check('atomic transfer keeps one Owner',transfer['current']['role']=='coordinator'and sql(f"select count(*)from public.account_members where owner_id='{owner}'and role='owner'and left_at is null;")=='1')
 expect('former Owner loses invite permission',"select public.task_app_invite('next@example.test','member',null);",owner,'P0403')
 check('new Owner keeps shared data partition',rpc('task_app_member_state','',coord)['current']['role']=='owner'and rpc('task_app_member_state','',coord)['workspace']['owner_id']==owner)
 before=sql(f"select last_seen_at from public.account_members where id='{mm}';")
 rpc('task_app_member_state','',member);check('Users read does not fake activity',sql(f"select last_seen_at from public.account_members where id='{mm}';")==before)
 ps=rpc('task_app_presence',f"'{users[15]}',true,1",member);check('presence uses personal session',ps['current']['active_until']is not None)
 check('member leaves without deleting tasks',sql('select public.task_app_leave_member();',member)=='t')
 check('departed member reads no tasks',sql('select count(*)from public.tasks;',member)=='0')
 expect('departed member cannot mutate',f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','status',null,'completed','this',null);",member,'P0403')
 check('all legacy functions private',sql("select count(*)from pg_proc where pronamespace='public'::regnamespace and proname like 'task_app_legacy_%'and has_function_privilege('authenticated',oid,'execute');")=='0')
 verification=sql((root/'supabase/verification/20261014_workspace_assignment_schema_checks.sql').read_text())
 checks=dict(line.split('|') for line in verification.splitlines())
 check('post-migration verification has no privilege or assignment violations',all(value=='0' for key,value in checks.items()if key!='verified_workspaces')and checks['verified_workspaces']=='2')
 print('All isolated workspace integration checks passed.',flush=True)
finally:subprocess.run(['docker','rm','-f',container],capture_output=True)
