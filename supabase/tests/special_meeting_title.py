#!/usr/bin/env python3
"""Shared Special Meeting title tests in disposable offline PostgreSQL only."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
fingerprint="select md5(jsonb_agg(jsonb_build_array(oid,proowner,proacl,prosrc)order by oid)::text)from pg_proc where pronamespace='public'::regnamespace and proname not in('task_app_special_meeting_title','task_app_set_special_meeting_title');"
source=source.replace(" for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())", " for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name.startswith('202610160033'): before_functions=sql("+repr(fingerprint)+")\n  sql(path.read_text())\n  if path.name.startswith('202610160033'): check('033 preserves existing function bodies and access',before_functions==sql("+repr(fingerprint)+"))")
cases=(root/'supabase/tests/special_meeting_title_cases.py').read_text()
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
