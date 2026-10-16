#!/usr/bin/env python3
"""Current037 notification/Missed checks in disposable, network-isolated PostgreSQL.
Historical migration tests retain their original Special fine/activation rules.
"""
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[2]
suite=sys.argv[1]if len(sys.argv)>1 else 'notifications'
if suite not in('notifications','missed_completion'):raise SystemExit('Choose notifications or missed_completion')
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
# Keep the production functions and all current guards, using an eligible
# Wednesday evening only inside this credential-free disposable test database.
clock_setup=r"""
sql("create table public.audit_test_clock(started timestamptz,at_time timestamptz);insert into public.audit_test_clock values(clock_timestamp(),'2026-12-23T20:00:00+05:30');create function public.audit_test_now()returns timestamptz language sql stable security definer set search_path=''as $$select at_time+(statement_timestamp()-started)from public.audit_test_clock$$;revoke all on public.audit_test_clock from public,anon,authenticated,service_role;revoke all on function public.audit_test_now()from public,anon,authenticated,service_role;")
functions=json.loads(sql("select jsonb_agg(pg_get_functiondef(oid))from pg_proc where pronamespace='public'::regnamespace and proname<>'audit_test_now'and prokind='f'and(prosrc like '%clock_timestamp()%'or prosrc like '%statement_timestamp()%'or prosrc like '%now()%');"))
import re
for definition in functions:
 definition=re.sub(r'(?<![\w.])now\(\)', 'public.audit_test_now()', definition)
 sql(definition.replace('clock_timestamp()','public.audit_test_now()').replace('statement_timestamp()','public.audit_test_now()'))
defaults=json.loads(sql("select jsonb_agg(jsonb_build_object('relation',quote_ident(n.nspname)||'.'||quote_ident(c.relname),'column',quote_ident(a.attname),'definition',pg_get_expr(d.adbin,d.adrelid)))from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and(pg_get_expr(d.adbin,d.adrelid)like '%statement_timestamp()%'or pg_get_expr(d.adbin,d.adrelid)like '%clock_timestamp()%'or pg_get_expr(d.adbin,d.adrelid)like '%now()%');"))
for default in defaults:
 definition=re.sub(r'(?<![\w.])now\(\)', 'public.audit_test_now()',default['definition']).replace('clock_timestamp()','public.audit_test_now()').replace('statement_timestamp()','public.audit_test_now()')
 sql(f"alter table {default['relation']} alter column {default['column']} set default {definition};")
sql('truncate public.task_notifications;')
"""
if suite=='notifications':
 cases=(root/'supabase/tests/notifications_cases.py').read_text()
 install="sql((root/'supabase/migrations/202610150025_notifications.sql').read_text())"
 assert cases.count(install)==1
 cases=cases.replace(install,'# Current migrations are already installed.')
 # Regular Healing work exercises financial notifications. Special Meeting is
 # intentionally locked and exempt from fines under036; its tests are separate.
 cases=cases.replace("and name='Special Meeting'","and name='Healing Meeting'")
 cases=cases.replace('clock_timestamp()','public.audit_test_now()').replace('statement_timestamp()','public.audit_test_now()')
else:cases=(root/'supabase/tests/current_missed_completion_cases.py').read_text()
cases=clock_setup+'\n'+cases
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
