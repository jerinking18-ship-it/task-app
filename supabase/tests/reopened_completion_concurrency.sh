#!/usr/bin/env bash
# Disposable PostgreSQL ONLY. Test version races and parallel decrements/increments.
set -euo pipefail
reopen_container="$1"
reopen_logs="$(mktemp -d)"
trap 'rm -rf "$reopen_logs"' EXIT
reopen_prefix="set request.jwt.claim.sub='00000000-0000-4000-8000-000000001061';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001062';set role authenticated;"
docker exec -i "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id) values('00000000-0000-4000-8000-000000001061');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001062','00000000-0000-4000-8000-000000001061');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001061';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001062';set role authenticated;
select public.task_app_choose_member(null,'Reopen Race')->'current'->>'name';
insert into public.tasks(title,status) select 'Reopen parallel '||n,'completed' from generate_series(1,40) n;
SQL
reopen_id="$(docker exec "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select id from public.tasks where owner_id='00000000-0000-4000-8000-000000001061' and title='Reopen parallel 1'")"
for reopen_status in active completed; do
 reopen_version="$(docker exec "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select updated_at from public.tasks where id='$reopen_id'")"
 for reopen_worker in 1 2; do
  docker exec "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$reopen_prefix select public.task_app_mutate('$reopen_id','$reopen_version','status',null,'$reopen_status');" > "$reopen_logs/race-$reopen_worker" 2>&1 &
 done
 wait
 [[ "$(rg -l '"conflict": true' "$reopen_logs"/race-* | wc -l | tr -d ' ')" == 1 ]]
 reopen_expected=40; [[ "$reopen_status" == active ]] && reopen_expected=39
 [[ "$(docker exec "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select completed_count from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001061'")" == "$reopen_expected" ]]
done
for reopen_status in active completed; do
 for reopen_worker in 1 2 3 4 5 6 7 8; do
  docker exec "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$reopen_prefix do \$\$declare t public.tasks;begin for t in select * from public.tasks where owner_id='00000000-0000-4000-8000-000000001061' and (split_part(title,' ',3)::int-1)%8=$reopen_worker-1 order by id loop perform public.task_app_mutate(t.id,t.updated_at,'status',null,'$reopen_status');end loop;end\$\$;" > "$reopen_logs/many-$reopen_worker" 2>&1 &
 done
 wait
 for reopen_worker in 1 2 3 4 5 6 7 8;do [[ ! -s "$reopen_logs/many-$reopen_worker" ]];done
 reopen_expected=40; [[ "$reopen_status" == active ]] && reopen_expected=0
 [[ "$(docker exec "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select completed_count from public.member_completion_totals where owner_id='00000000-0000-4000-8000-000000001061'")" == "$reopen_expected" ]]
done
docker exec "$reopen_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "delete from public.tasks where owner_id='00000000-0000-4000-8000-000000001061';delete from auth.users where id='00000000-0000-4000-8000-000000001061'"
echo 'PASS: racing reopen/recomplete adjusts exactly once; 40 parallel reopenings reach zero, recompletions restore forty'
