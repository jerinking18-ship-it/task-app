#!/usr/bin/env python3
"""Run established Missed/notification checks on the complete local schema."""
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[2]
suite=sys.argv[1]if len(sys.argv)>1 else 'notifications'
if suite not in('notifications','missed_completion'):raise SystemExit('Choose notifications or missed_completion')
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
cases=(root/f'supabase/tests/{suite}_cases.py').read_text()
migration='202610150025_notifications.sql'if suite=='notifications'else '202610150024_missed_completion.sql'
install=f"sql((root/'supabase/migrations/{migration}').read_text())"
assert cases.count(install)==1
cases=cases.replace(install,'# Complete current migrations were already installed by the isolated harness.')
# Final-schema bootstrap can emit a fixture-only reassignment notice; these
# suites begin at an empty inbox just as their historical upgrade harness did.
if suite=='notifications':source+="\n sql('truncate public.task_notifications;')\n"
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
