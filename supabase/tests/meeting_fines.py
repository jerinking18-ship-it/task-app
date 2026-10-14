#!/usr/bin/env python3
"""Runs actual migrations and fine integration tests in the existing offline disposable harness."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text()
cases=(root/'supabase/tests/meeting_fines_cases.py').read_text()
# Insert while all verified fictional workspaces/roles still exist, before cleanup.
source=source.replace(" print('All isolated workspace integration checks passed.',flush=True)","\n"+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\n print('All isolated workspace and fine integration checks passed.',flush=True)")
exec(compile(source,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
