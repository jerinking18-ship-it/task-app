#!/usr/bin/env python3
"""Template assignments: disposable network-none PostgreSQL, never hosted."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
source=source.replace("for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())", "for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name<'202611020042':sql(path.read_text())")
cases=r'''
template_id=users[10]
old_items=[{'title':'Legacy sound setup','notes':'Keep existing notes'}]
old=rpc('task_app_save_template',f"'{template_id}',null,'Legacy template',{literal(old_items)}",owner)
bin_id=users[11]
bin_template=rpc('task_app_save_template',f"'{bin_id}',null,'Saved Bin template',{literal(old_items)}",coord)
rpc('task_app_remove_template',f"'{bin_id}','{bin_template['updated_at']}',true",owner)
tables=sql("select tablename from pg_tables where schemaname='public'order by tablename;").splitlines()
def rows_snapshot():return {name:sql('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),\'[]\'::jsonb)from public.'+name+' t;')for name in tables}
before=rows_snapshot()
acl_query="select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proacl,p.prosecdef,p.proconfig)order by p.oid::regprocedure::text)from pg_proc p where p.pronamespace='public'::regnamespace;"
acls=sql(acl_query)
table_acls=sql("select jsonb_agg(jsonb_build_array(c.relname,c.relacl,c.relrowsecurity)order by c.relname)from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r';")
sql((root/'supabase/migrations/202611020042_template_assignments.sql').read_text())
check('042 preserves all existing public table rows including tasks and Bin templates',rows_snapshot()==before)
check('042 preserves function access and security-definer/search-path configuration',sql(acl_query)==acls)
check('042 preserves table permissions and RLS',sql("select jsonb_agg(jsonb_build_array(c.relname,c.relacl,c.relrowsecurity)order by c.relname)from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r';")==table_acls)
check('legacy template items remain unchanged and readable',json.loads(sql(f"select items from public.task_templates where id='{template_id}';",coord))==old_items)
assigned=[{'title':'Check microphones','notes':'Test sound','assignedToId':mm},{'title':'Prepare camera','notes':'Keep this note','assignedToId':cm},{'title':'Choose later','notes':'','assignedToId':None}]
updated=rpc('task_app_save_template',f"'{template_id}','{old['updated_at']}','Assigned template',{literal(assigned)}",coord)
check('Coordinator saves exact ordered assignments and optional clear',updated['items']==assigned)
check('assignment save creates no tasks',sql('select count(*)from public.tasks;')=='1')
check('Owner reads shared assigned template',json.loads(sql(f"select items from public.task_templates where id='{template_id}';",owner))==assigned)
new_id=users[12]
created=rpc('task_app_save_template',f"'{new_id}',null,'Assigned create',{literal(assigned)}",owner)
retry=rpc('task_app_save_template',f"'{new_id}',null,'Assigned create',{literal(assigned)}",coord)
check('lost create response retries remain idempotent including assignees',created==retry)
expect('stale assignment update cannot overwrite newer data',f"select public.task_app_save_template('{template_id}','{old['updated_at']}','Stale',{literal(assigned)});",owner,'P0013')
expect('Member cannot save template assignments',f"select public.task_app_save_template('{new_id}',null,'Forbidden',{literal(assigned)});",member,'P0403')
expect('unjoined identity cannot save assignments',f"select public.task_app_save_template('{new_id}',null,'Forbidden',{literal(assigned)});",wrong,'P0403')
expect('unverified identity cannot save assignments',f"select public.task_app_save_template('{new_id}',null,'Forbidden',{literal(assigned)});",unverified,'P0403')
foreign_member=rpc('task_app_member_state','',outsider)['current']['id']
for title,assignee in [('cross-workspace',foreign_member),('nonexistent',users[18])]:
 expect(title+' assignee rejected',f"select public.task_app_save_template('{users[13]}',null,'Bad',{literal([dict(assigned[0],assignedToId=assignee)])});",owner,'23514')
for value in ['',123,False,[],{},'bad-uuid']:
 expect('malformed assignment rejected '+str(value),f"select public.task_app_save_template('{users[13]}',null,'Bad',{literal([dict(assigned[0],assignedToId=value)])});",owner,'23514')
for extra in [{'repeat_rule':'daily'},{'owner_id':owner},{'assignedToName':'Forged'}]:
 expect('extra template fields rejected '+str(list(extra)),f"select public.task_app_save_template('{users[13]}',null,'Bad',{literal([{**assigned[0],**extra}])});",owner,'23514')
check('failed saves preserve saved assignment version',sql(f"select updated_at from public.task_templates where id='{template_id}';")==sql(f"select '{updated['updated_at']}'::timestamptz;"))
expect('Member direct read stays empty/blocked',f"select public.task_app_deleted_templates();",member,'P0403')
check('Member cannot directly read assigned templates',sql('select count(*)from public.task_templates;',member)=='0')
expect('direct template update remains denied',f"update public.task_templates set items={literal(old_items)} where id='{template_id}';",owner,'42501')
expect('private legacy save cannot bypass assignee validation',f"select public.task_app_legacy_save_template('{users[13]}',null,'Bypass',{literal(assigned)});",owner,'42501')
for role in ['anon','service_role']:
 sql(f"set role {role};select public.task_app_save_template('{users[13]}',null,'Bypass',{literal(assigned)});",fail='42501')
check('signed-out and service roles cannot call save',True)
bin_version=sql(f"select updated_at from public.task_templates where id='{bin_id}';")
rpc('task_app_bin_items',f"'restore',{literal([{'kind':'template','id':bin_id,'version':bin_version}])},true",coord)
check('legacy Bin template restore still works',json.loads(sql(f"select items from public.task_templates where id='{bin_id}';",owner))==old_items)
removed=rpc('task_app_remove_template',f"'{template_id}','{updated['updated_at']}',true",coord)
check('assigned template Bin retains exact assignments',next(t['items']for t in rpc('task_app_deleted_templates','',owner)if t['id']==template_id)==assigned)
rpc('task_app_bin_items',f"'restore',{literal([{'kind':'template','id':template_id,'version':removed['updated_at']}])},true",owner)
check('assigned template restore retains assignments',json.loads(sql(f"select items from public.task_templates where id='{template_id}';",coord))==assigned)
sql('select public.task_app_leave_member();',member)
check('departed assignee does not corrupt existing saved templates',json.loads(sql(f"select items from public.task_templates where id='{template_id}';",owner))==assigned)
expect('new saves cannot assign a departed member',f"select public.task_app_save_template('{users[13]}',null,'Departed',{literal(assigned)});",owner,'23514')
cleared=[dict(item,assignedToId=None)for item in assigned]
current_version=sql(f"select updated_at from public.task_templates where id='{template_id}';")
check('manager can clear stale saved assignments',rpc('task_app_save_template',f"'{template_id}','{current_version}','Assigned template',{literal(cleared)}",owner)['items']==cleared)
rpc('task_app_change_role',f"'{cm}','coordinator','member',true",owner)
expect('demoted Coordinator loses template assignment access immediately',f"select public.task_app_save_template('{users[13]}',null,'Demoted',{literal(cleared)});",coord,'P0403')
print('All template assignment integration checks passed.',flush=True)
'''
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
