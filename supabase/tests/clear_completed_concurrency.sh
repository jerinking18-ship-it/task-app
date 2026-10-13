#!/usr/bin/env bash
# Disposable network-isolated container supplied by run-local.sh only.
set -euo pipefail
completed_sql_container="$1"
completed_race_dir="$(mktemp -d)"
trap 'rm -rf "$completed_race_dir"' EXIT
docker exec -i "$completed_sql_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id) values('00000000-0000-4000-8000-000000000701');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000711','00000000-0000-4000-8000-000000000701');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000701';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000711';
set role authenticated;
select public.task_app_choose_member(null,'Completed Race')->'current'->>'name';
insert into public.tasks(title,status) values('Race completed one','completed'),('Race completed two','completed'),('Race active','active');
reset role;
create table public.local_completed_race as select public.task_app_completed('preview') snapshot;
grant select on public.local_completed_race to authenticated;
SQL
completed_race(){
 docker exec -i "$completed_sql_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000701';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000711';
set role authenticated;
select public.task_app_completed('purge',(select (snapshot->>'count')::bigint from public.local_completed_race),(select snapshot->>'snapshot' from public.local_completed_race),true);
SQL
}
set +e
completed_race >"$completed_race_dir/first.log" 2>&1 & completed_first_pid=$!
completed_race >"$completed_race_dir/second.log" 2>&1 & completed_second_pid=$!
wait "$completed_first_pid"; completed_first_status=$?
wait "$completed_second_pid"; completed_second_status=$?
set -e
if ! { { [ "$completed_first_status" -eq 0 ] && [ "$completed_second_status" -ne 0 ]; } || { [ "$completed_first_status" -ne 0 ] && [ "$completed_second_status" -eq 0 ]; }; }; then
 cat "$completed_race_dir/first.log" "$completed_race_dir/second.log";exit 1
fi
rg -q 'Completed tasks changed' "$completed_race_dir/first.log" "$completed_race_dir/second.log"
docker exec -i "$completed_sql_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
 assert not exists(select 1 from public.tasks where title in('Race completed one','Race completed two'));
 assert exists(select 1 from public.tasks where title='Race active' and status='active' and deleted_at is null);
end $$;
drop table public.local_completed_race;
SQL
echo 'PASS: concurrent Completed clears delete the reviewed set once, reject stale confirmation and retain active tasks'
