#!/usr/bin/env bash
# Disposable local Docker database only. No network or production requests.
set -euo pipefail
task_container="$1"
task_result_dir="$(mktemp -d)"
trap 'rm -rf "$task_result_dir"' EXIT
task_pair="$(docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "insert into public.tasks(owner_id,title,due_date,repeat_rule) values('00000000-0000-4000-8000-000000000001','Midnight concurrent fixture','2099-01-01','daily') returning id,updated_at;")"
IFS='|' read -r task_id task_version <<< "$task_pair"
for task_writer in 1 2; do
  docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
    "begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; select public.task_app_mutate('$task_id','$task_version','status',null,'completed'); select pg_sleep(0.2); commit;" \
    > "$task_result_dir/completion-$task_writer" &
done
wait
rg -q '"conflict": true' "$task_result_dir"
docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin assert (select count(*) from public.tasks where title='Midnight concurrent fixture')=1; assert (select count(*) from public.task_repeat_pending where source_task_id='$task_id')=1; end \$\$;"
for task_worker in 1 2 3; do
  docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
    "begin; select public.task_app_release_repeats(null,'2099-01-01T18:30Z'); select pg_sleep(0.2); commit;" \
    > "$task_result_dir/release-$task_worker" &
done
wait
docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin assert (select count(*) from public.tasks where title='Midnight concurrent fixture')=2; assert (select count(*) from public.tasks where title='Midnight concurrent fixture' and status='active')=1; assert public.task_app_release_repeats(null,'2099-01-01T18:30Z')=0; end \$\$;"
echo 'PASS: simultaneous completions reserve one schedule; concurrent workers create exactly one task'

task_stop_pair="$(docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "insert into public.tasks(owner_id,title,due_date,repeat_rule) values('00000000-0000-4000-8000-000000000001','Midnight concurrent stop','2099-01-01','daily') returning id;")"
docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "update public.tasks set status='completed' where id='$task_stop_pair';"
docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "begin; set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; select public.task_app_mutate(id,updated_at,'update',jsonb_build_object('title',title,'notes',notes,'status',status,'due_date',due_date,'due_time',due_time,'priority',priority,'category_id',category_id,'weekdays',to_jsonb(weekdays),'repeat_rule','off'),null,'future',updated_at) from public.tasks where id='$task_stop_pair'; select 'STOP_LOCK_HELD'; select pg_sleep(1); commit;" \
  > "$task_result_dir/stop" &
task_stop_writer=$!
for task_attempt in {1..40}; do
  if rg -q 'STOP_LOCK_HELD' "$task_result_dir/stop"; then break; fi
  sleep 0.05
done
rg -q 'STOP_LOCK_HELD' "$task_result_dir/stop"
docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin assert public.task_app_release_repeats(null,'2099-01-01T18:30Z')=0; end \$\$;"
wait "$task_stop_writer"
docker exec "$task_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin assert public.task_app_release_repeats(null,'2099-01-01T18:30Z')=0; assert (select count(*) from public.tasks where title='Midnight concurrent stop')=1; assert (select cancelled from public.task_repeat_pending where source_task_id='$task_stop_pair'); end \$\$;"
echo 'PASS: a concurrent Stop repeat holds the series lock; workers skip it and never generate the cancelled occurrence'
