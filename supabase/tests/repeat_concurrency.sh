#!/usr/bin/env bash
# Local disposable Docker container supplied by run-local.sh; no network.
set -euo pipefail
task_container="$1"
task_result_dir="$(mktemp -d)"
trap 'rm -rf "$task_result_dir"' EXIT
task_pair="$(docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "insert into public.tasks(owner_id,title,due_date,repeat_rule) values('00000000-0000-4000-8000-000000000001','Concurrent local fixture','2099-01-01','daily') returning id,updated_at;")"
IFS='|' read -r task_id task_version <<< "$task_pair"
for task_writer in 1 2; do
  docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
    "begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; select public.task_app_mutate('$task_id','$task_version','status',null,'completed'); select pg_sleep(0.2); commit;" \
    > "$task_result_dir/$task_writer" &
done
wait
docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin assert (select count(*) from public.tasks where title='Concurrent local fixture')=2; assert (select count(*) from public.tasks where title='Concurrent local fixture' and status='active')=1; end \$\$;"
rg -q '"conflict": true' "$task_result_dir"
rg -q '"status": "completed"' "$task_result_dir"
echo 'PASS: concurrent original-version completions create exactly one successor; stale writer gets conflict'
