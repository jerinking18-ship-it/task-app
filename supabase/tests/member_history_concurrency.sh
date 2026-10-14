#!/usr/bin/env bash
# Disposable offline PostgreSQL ONLY. Never target a hosted database.
set -euo pipefail
history_container="$1"
history_logs="$(mktemp -d)"
trap 'rm -rf "$history_logs"' EXIT
history_prefix="set request.jwt.claim.sub='00000000-0000-4000-8000-000000001041';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001042';set role authenticated;"
docker exec -i "$history_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id) values('00000000-0000-4000-8000-000000001041');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001042','00000000-0000-4000-8000-000000001041');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001041';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001042';set role authenticated;
select public.task_app_choose_member(null,'History Race')->'current'->>'name';
insert into public.tasks(title) values('Same occurrence');
SQL
history_id="$(docker exec "$history_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select id from public.tasks where owner_id='00000000-0000-4000-8000-000000001041' and title='Same occurrence'")"
history_version="$(docker exec "$history_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select updated_at from public.tasks where id='$history_id'")"
for history_worker in 1 2;do
 (set +e;docker exec "$history_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$history_prefix select public.task_app_mutate('$history_id','$history_version','status',null,'completed');" > "$history_logs/same-$history_worker" 2>&1;echo "$?" > "$history_logs/status-$history_worker") &
done
wait
history_successes=0
for history_worker in 1 2;do
 if [[ "$(cat "$history_logs/status-$history_worker")" == 0 ]];then history_successes=$((history_successes+1));else rg -q 'changed' "$history_logs/same-$history_worker";fi
done
[[ "$history_successes" == 1 ]]
for history_worker in 1 2 3 4 5 6 7 8;do
 docker exec "$history_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$history_prefix insert into public.tasks(title,status) select 'Parallel $history_worker-'||n,'completed' from generate_series(1,5) n;" > "$history_logs/many-$history_worker" 2>&1 &
done
wait
for history_worker in 1 2 3 4 5 6 7 8;do [[ ! -s "$history_logs/many-$history_worker" ]];done
docker exec -i "$history_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 assert (select count(*) from public.member_task_completions where owner_id='00000000-0000-4000-8000-000000001041')=41;
 assert (select completed_count from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001041')=41;
end$$;
delete from public.tasks where owner_id='00000000-0000-4000-8000-000000001041';
delete from auth.users where id='00000000-0000-4000-8000-000000001041';
do $$begin assert not exists(select 1 from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001041');end$$;
SQL
echo 'PASS: racing same occurrence counted once; 40 parallel completions lost no increments; account deletion cascades statistics'
