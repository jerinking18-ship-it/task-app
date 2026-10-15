#!/usr/bin/env python3
"""New self-unmark integration on offline disposable PostgreSQL, never hosted Supabase."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/absence_coverage.py').read_text()
cases=(root/'supabase/tests/unmark_absence_cases.py').read_text()
marker=" expiry_task=create(title='Expires before claim')"
assert marker in source
source=source.replace(marker,'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+'\n'+marker)
exec(compile(source,str(root/'supabase/tests/absence_coverage.py'),'exec'),{'__file__':str(root/'supabase/tests/absence_coverage.py')})
