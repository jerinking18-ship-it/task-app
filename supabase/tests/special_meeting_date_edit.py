#!/usr/bin/env python3
"""Shared date editing checks; disposable network-isolated PostgreSQL only."""
import ast
from pathlib import Path
root=Path(__file__).resolve().parents[2]
runner=ast.parse((root/'supabase/tests/activity_log.py').read_text())
source=next(ast.literal_eval(n.value)for n in runner.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='source'for t in n.targets))
# This is the historical036/037 upgrade-preservation test. Later migrations
# require036/037 to be present first; current-schema suites cover those guards.
source=source.replace("  sql(path.read_text())","  if not path.name.startswith(('202610160036','202610160037','202610180038','202610180039','202610180040','202610180041')):sql(path.read_text())")
cases=(root/'supabase/tests/special_meeting_events_cases.py').read_text()
cases+='\n'+(root/'supabase/tests/special_meeting_date_edit_cases.py').read_text()
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
