#!/usr/bin/env python3
"""Notification and request integration checks in offline disposable PostgreSQL."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
source=source.replace("for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())","for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name<'202610150025':sql(path.read_text())")
cases=(root/'supabase/tests/notifications_cases.py').read_text()
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
