#!/usr/bin/env bash
# DISPOSABLE LOCAL container only; checks the 10th slot under concurrent devices.
set -euo pipefail
task_members_container="$1"
task_members_tmp="$(mktemp -d)"
trap 'rm -rf "$task_members_tmp"' EXIT
for task_member_n in 81 82; do
  (
    docker exec -i "$task_members_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
set request.jwt.claim.session_id='00000000-0000-4000-8000-$(printf '%012d' "$task_member_n")';
select public.task_app_choose_member(null,'Concurrent $task_member_n');
SQL
  ) >"$task_members_tmp/$task_member_n.log" 2>&1 &
done
wait || true
docker exec -i "$task_members_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  assert (select count(*) from public.account_members where owner_id='00000000-0000-4000-8000-000000000080')=10;
  assert (select count(*) from public.account_member_sessions where owner_id='00000000-0000-4000-8000-000000000080')=1;
end $$;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000083';
do $$ declare member uuid; begin
  begin perform public.task_app_choose_member(null,'Eleventh'); raise exception 'Expected cap';
    exception when sqlstate 'P0010' then null; end;
  select id into member from public.account_members where name='Existing 1';
  perform public.task_app_choose_member(member,null);
  assert jsonb_array_length(public.task_app_member_state()->'members')=10;
end $$;
select 'PASS: concurrent devices cannot exceed10; existing member selectable at capacity';
SQL

# Two different members complete the same original version. Only the winner is
# attributed; the stale request cannot replace the name of the first completion.
docker exec -i "$task_members_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000084';
select public.task_app_choose_member((select id from public.account_members where name='Existing 2'),null)->'current'->>'name';
reset role;
insert into public.tasks(id,owner_id,title) values('00000000-0000-4000-8000-000000000088','00000000-0000-4000-8000-000000000080','Concurrent member completion');
create table public.local_member_completion_version as select id,updated_at from public.tasks where id='00000000-0000-4000-8000-000000000088';
grant select on public.local_member_completion_version to authenticated;
SQL
for task_member_n in 83 84; do
  docker exec -i "$task_members_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 >"$task_members_tmp/complete-$task_member_n.log" <<SQL &
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
set request.jwt.claim.session_id='00000000-0000-4000-8000-$(printf '%012d' "$task_member_n")';
select public.task_app_mutate(id,updated_at,'status',null,'completed') from public.local_member_completion_version;
SQL
done
wait
docker exec "$task_members_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 \
  -c "select jsonb_build_object('completed_by_member_id',completed_by_member_id,'completed_by_name',completed_by_name) from public.tasks where id='00000000-0000-4000-8000-000000000088'" >"$task_members_tmp/stored-completion.log"
python3 - "$task_members_tmp" <<'PY'
import json,sys
from pathlib import Path
responses=[json.loads((Path(sys.argv[1])/f'complete-{n}.log').read_text().strip()) for n in (83,84)]
assert sum(bool(row.get('conflict')) for row in responses)==1,responses
winner=next(row for row in responses if not row.get('conflict'))
stored=json.loads((Path(sys.argv[1])/'stored-completion.log').read_text().strip())
assert winner['completed_by_name'] in ['Existing 1','Existing 2']
assert stored['completed_by_member_id']==winner['completed_by_member_id']
assert stored['completed_by_name']==winner['completed_by_name']
print('PASS: concurrent member completion records only the winning member; stale completion cannot replace attribution')
PY
