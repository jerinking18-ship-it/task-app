#!/usr/bin/env python3
"""Missed restrictions/permissions/fines in disposable offline PostgreSQL only."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
cases=(root/'supabase/tests/restricted_absence_cases.py').read_text()
program=source+'\n'+'\n'.join(' '+line if line else '' for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
