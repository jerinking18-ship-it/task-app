#!/usr/bin/env python3
"""October 30 Data API defaults: disposable PostgreSQL only, never hosted.

catalog compares a rebuilt schema under legacy, announced platform and stricter
no-table/sequence-default grants. suite runs existing feature regressions under
those defaults. No production migration or application source is patched.
"""
from pathlib import Path
import json, runpy, sys
ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / 'supabase/tests/local-bootstrap.sql'
MODES = ('legacy', 'platform', 'strict')
SUITES = {
 'workspace':'workspace_assignments.py', 'check-in':'meeting_check_in.py',
 'notifications':'current_schema_regressions.py', 'missed':'current_schema_regressions.py',
 'special':'special_meeting_date_edit.py', 'bulk':'bulk_reassignment.py',
 'retention':'activity_retention.py', 'completion-lock':'meeting_completion_lock.py',
}
kind = sys.argv[1] if len(sys.argv)>1 else 'catalog'
name = sys.argv[2] if len(sys.argv)>2 else 'platform'
mode = (sys.argv[3] if len(sys.argv)>3 else 'platform') if kind=='suite' else name
if mode not in MODES or kind not in ('catalog','suite') or kind=='suite' and name not in SUITES:
 raise SystemExit('Use catalog legacy|platform|strict OR suite '+ '|'.join(SUITES)+' [platform|strict]')
read_text = Path.read_text

def bootstrap_text():
 text = read_text(BOOTSTRAP)
 assert 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role;' in text
 # Match the old platform sequence defaults as well as the existing table stand-in.
 text += '\nalter default privileges in schema public grant all on sequences to anon,authenticated,service_role;\n'
 if mode=='platform':
  text += 'alter default privileges in schema public revoke select,insert,update,delete on tables from anon,authenticated,service_role;\nalter default privileges in schema public revoke usage,select on sequences from anon,authenticated,service_role;\n'
 elif mode=='strict':
  text += 'alter default privileges in schema public revoke all on tables from anon,authenticated,service_role;\nalter default privileges in schema public revoke all on sequences from anon,authenticated,service_role;\n'
 expected='true' if mode=='legacy' else 'false'
 text += """create table public.__explicit_grant_probe(id integer);
 create sequence public.__explicit_grant_sequence;
 do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop
 if has_table_privilege(r,'public.__explicit_grant_probe','select') is distinct from %s
 or has_sequence_privilege(r,'public.__explicit_grant_sequence','usage') is distinct from %s
 then raise exception 'Test defaults did not take effect';end if;end loop;end;$$;
 drop table public.__explicit_grant_probe;drop sequence public.__explicit_grant_sequence;
 """%(expected,expected)
 return text

def patched_read(self,*args,**kwargs):
 return bootstrap_text() if self.resolve()==BOOTSTRAP.resolve() else read_text(self,*args,**kwargs)

Path.read_text = patched_read
try:
 if kind=='suite':
  sys.argv=[str(ROOT/'supabase/tests'/SUITES[name])]+(['notifications' if name=='notifications' else 'missed_completion']if name in('notifications','missed')else[])
  print('EXPLICIT GRANTS',mode,'SUITE',name,flush=True)
  runpy.run_path(sys.argv[0],run_name='__main__')
 else:
  source=read_text(ROOT/'supabase/tests/workspace_assignments.py').split(' for n,u in enumerate(users,1):')[0]
  cases=r'''
report=json.loads(sql((root/'supabase/verification/20261027_explicit_grants_checks.sql').read_text()))
check('all thirty tables and fifty-four required functions audited',report['app_tables']==30 and report['required_functions']==54)
check('required reads and private RPC boundaries survive '+audit_mode,not report['issues'])
check('only four authenticated direct read tables',report['authenticated_select_tables']==['account_settings','categories','task_templates','tasks'])
check('no signed-out direct table reads',report['public_anon_select_tables']==0)
# Prove the verifier catches both an outage and an accidental exposure.
sql('revoke select on public.tasks from authenticated;')
missing=json.loads(sql((root/'supabase/verification/20261027_explicit_grants_checks.sql').read_text()))
check('verifier catches missing table grant','missing authenticated SELECT: tasks'in missing['issues'])
sql('grant select on public.tasks to authenticated;revoke execute on function public.task_app_check_in_state(boolean)from authenticated;')
missing=json.loads(sql((root/'supabase/verification/20261027_explicit_grants_checks.sql').read_text()))
check('verifier catches missing RPC grant','missing authenticated RPC: task_app_check_in_state'in missing['issues'])
sql('grant execute on function public.task_app_check_in_state(boolean)to authenticated;grant select on public.task_member_check_ins to anon;')
exposed=json.loads(sql((root/'supabase/verification/20261027_explicit_grants_checks.sql').read_text()))
check('verifier catches private check-in exposure','unintended direct SELECT: task_member_check_ins / anon'in exposed['issues'])
sql('revoke select on public.task_member_check_ins from anon;')
check('restored verifier has zero issues',not json.loads(sql((root/'supabase/verification/20261027_explicit_grants_checks.sql').read_text()))['issues'])
# ACL changes to future objects must not alter any current table/function grants.
catalog_sql="""select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'role',r.role,'select',has_any_column_privilege(r.role,c.oid,'SELECT'),'insert',has_any_column_privilege(r.role,c.oid,'INSERT'),'update',has_any_column_privilege(r.role,c.oid,'UPDATE'),'delete',has_table_privilege(r.role,c.oid,'DELETE'))order by c.relname,r.role)from pg_class c cross join(values('anon'),('authenticated'),('service_role'))r(role)where c.relnamespace='public'::regnamespace and c.relkind='r'),'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',md5(p.prosrc),'definer',p.prosecdef,'config',p.proconfig,'role',r.role,'execute',has_function_privilege(r.role,p.oid,'execute'))order by p.oid::regprocedure::text,r.role)from pg_proc p cross join(values('anon'),('authenticated'),('service_role'))r(role)where p.pronamespace='public'::regnamespace and p.proname like 'task_app_%'))"""
catalog=json.loads(sql(catalog_sql))
sql('alter default privileges in schema public revoke select,insert,update,delete on tables from anon,authenticated,service_role;alter default privileges in schema public revoke usage,select on sequences from anon,authenticated,service_role;')
check('changing future defaults preserves all existing function/table permissions',catalog==json.loads(sql(catalog_sql)))
# Real signed-out roles are denied at the role layer without reading any rows.
for role in ['anon','service_role']:
 sql('set role '+role+';select id from public.tasks limit 0;',fail='42501')
check('signed-out and service role direct reads stay denied',True)
for table in ['tasks','categories','account_settings','task_templates']:
 sql('set role authenticated;select * from public.'+table+' limit 0;')
check('all four client SELECT routes work as authenticated',True)
check('realtime private channel SELECT permission retained',sql("select has_table_privilege('authenticated','realtime.messages','select');")=='t')
check('no unexpected public sequences require implicit API access',sql("select count(*)from pg_class where relnamespace='public'::regnamespace and relkind='S';")=='0')
(root/'design').mkdir(exist_ok=True)
(root/'design'/('explicit-grants-catalog-'+audit_mode+'-20261027.json')).write_text(json.dumps({'mode':audit_mode,'report':report,'catalog':catalog},indent=2)+'\n')
'''
  program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
  exec(compile(program,str(ROOT/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(ROOT/'supabase/tests/workspace_assignments.py'),'audit_mode':mode})
finally:
 Path.read_text=read_text
