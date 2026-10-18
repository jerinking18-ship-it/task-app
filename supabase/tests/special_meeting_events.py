#!/usr/bin/env python3
"""Full-schema Special Meeting checks; disposable network-isolated PostgreSQL only."""
import ast
from pathlib import Path
root=Path(__file__).resolve().parents[2]
runner=ast.parse((root/'supabase/tests/activity_log.py').read_text())
source=next(ast.literal_eval(n.value)for n in runner.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='source'for t in n.targets))
source=source.replace("  sql(path.read_text())","  if not path.name.startswith(('202610160036','202610160037','202610180038')):sql(path.read_text())")
cases=(root/'supabase/tests/special_meeting_events_cases.py').read_text()
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
