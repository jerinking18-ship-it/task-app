#!/usr/bin/env python3
"""Four-category guard in disposable, network-isolated PostgreSQL only."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
source=source.replace("for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())", "for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name<'202610180040':sql(path.read_text())")
cases=r'''
rpc('task_app_setup',"'bootstrap',null",owner)
migration=(root/'supabase/migrations/202610180040_four_meeting_categories.sql').read_text()
legacy='00000000-0000-4000-8000-000000008801'
sql(f"insert into public.categories(id,owner_id,name)values('{legacy}','{owner}','Custom legacy category');")
sql(migration,fail='23514')
check('unexpected legacy category prevents install without deletion',sql(f"select count(*)from public.categories where id='{legacy}'and name='Custom legacy category';")=='1')
check('failed installation leaves no partial constraint',sql("select count(*)from pg_constraint where conname='task_app_meeting_categories_only';")=='0')
# Disposable fictional fixture only; no hosted connection exists.
sql(f"delete from public.categories where id='{legacy}';")
def snapshot():
 return sql("select md5(jsonb_build_object('categories',(select jsonb_agg(to_jsonb(c)order by id)from public.categories c),'tasks',(select jsonb_agg(to_jsonb(t)order by id)from public.tasks t),'members',(select jsonb_agg(to_jsonb(m)order by id)from public.account_members m),'fines',(select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f),'auth_count',(select count(*)from auth.users),'functions',(select jsonb_agg(jsonb_build_array(oid,proowner,proacl,prosrc)order by oid)from pg_proc where pronamespace='public'::regnamespace),'security',(select jsonb_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity)order by oid)from pg_class where relnamespace='public'::regnamespace and relkind='r'))::text);")
before=snapshot();sql(migration)
check('installation preserves all rows function definitions and table security',snapshot()==before)
for who in [owner,coord]:
 for name in ['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting']:
  result=rpc('task_app_setup',"'category','"+name+"'",who)
  check('manager can use '+name,result['category']['name']==name)
 for name in ['Custom category','Youth Meeting','sunday service']:
  expect('manager cannot create '+name,"select public.task_app_setup('category','"+name+"');",who,'23514')
expect('Member cannot create categories',"select public.task_app_setup('category','Sunday Service');",member,'P0403')
expect('private unauthenticated category creation denied',"set role anon;select public.task_app_setup('category','Sunday Service');",None,'42501')
expect('constraint prevents privileged custom insertion',f"insert into public.categories(owner_id,name)values('{owner}','Bypass');",None,'23514')
expect('constraint prevents privileged category rename',"update public.categories set name='Bypass'where name='Sunday Service';",None,'23514')
check('all fixed categories remain available',int(sql(f"select count(*)from public.categories where owner_id='{owner}';"))==4)
check('read-only deployment verification has no issues',sql((root/'supabase/verification/20261018_four_meeting_categories_checks.sql').read_text())=='')
sql(migration,fail='42710');check('replay rejected without changing rows',int(sql(f"select count(*)from public.categories where owner_id='{owner}';"))==4)
print('PASS all040 fixed-category checks',flush=True)
'''
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
