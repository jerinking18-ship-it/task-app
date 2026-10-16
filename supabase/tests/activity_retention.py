#!/usr/bin/env python3
"""Activity security and retention checks in disposable offline PostgreSQL only."""
import ast
from pathlib import Path

root=Path(__file__).resolve().parents[2]
runner=ast.parse((root/'supabase/tests/activity_log.py').read_text())
source=next(ast.literal_eval(node.value)for node in runner.body if isinstance(node,ast.Assign)and any(isinstance(target,ast.Name)and target.id=='source'for target in node.targets))
cases=(root/'supabase/tests/activity_log_cases.py').read_text()+'\n'+(root/'supabase/tests/activity_retention_cases.py').read_text()
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
