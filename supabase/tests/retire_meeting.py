#!/usr/bin/env python3
"""Category retirement on an offline disposable PostgreSQL container; never hosted."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text()
prefix=source.split(' sql(f"update auth.sessions set not_after')[0]
old=" for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())"
assert old in prefix
prefix=prefix.replace(old," for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name<'202610150021':sql(path.read_text())")
cases=(root/'supabase/tests/retire_meeting_cases.py').read_text()
program=prefix+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
