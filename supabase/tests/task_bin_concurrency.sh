#!/usr/bin/env bash
# Disposable network-isolated local container only, supplied by run-local.sh.
set -euo pipefail
bin_sql_container="$1"
bin_sql_database=meeting_feature_tests
bin_race_dir="$(mktemp -d)"
trap 'rm -rf "$bin_race_dir"' EXIT
docker exec -i "$bin_sql_container" psql -X -q -At -U postgres -d "$bin_sql_database" -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id) values('00000000-0000-4000-8000-000000000501');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000511','00000000-0000-4000-8000-000000000501');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000501';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000511';
set role authenticated;
select public.task_app_choose_member(null,'Local Bin Race')->'current'->>'name';
insert into public.tasks(title,due_date,repeat_rule) values('Concurrent Bin restore',(statement_timestamp() at time zone 'Asia/Kolkata')::date,'daily');
do $$ declare t public.tasks;begin
 select * into t from public.tasks where title='Concurrent Bin restore';perform public.task_app_mutate(t.id,t.updated_at,'status',null,'completed');
 select * into t from public.tasks where id=t.id;perform public.task_app_mutate(t.id,t.updated_at,'delete');
end $$;
reset role;
create table public.local_bin_race as select jsonb_build_array(jsonb_build_object('id',id,'version',updated_at)) selections from public.tasks where title='Concurrent Bin restore';
grant select on public.local_bin_race to authenticated;
SQL
bin_restore_race(){
 docker exec -i "$bin_sql_container" psql -X -q -At -U postgres -d "$bin_sql_database" -v ON_ERROR_STOP=1 <<'SQL'
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000501';
set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000511';
set role authenticated;
select public.task_app_bin('restore',(select selections from public.local_bin_race),true);
SQL
}
set +e
bin_restore_race >"$bin_race_dir/first.log" 2>&1 & bin_first_pid=$!
bin_restore_race >"$bin_race_dir/second.log" 2>&1 & bin_second_pid=$!
wait "$bin_first_pid"; bin_first_status=$?
wait "$bin_second_pid"; bin_second_status=$?
set -e
if ! { { [ "$bin_first_status" -eq 0 ] && [ "$bin_second_status" -ne 0 ]; } || { [ "$bin_first_status" -ne 0 ] && [ "$bin_second_status" -eq 0 ]; }; }; then
 cat "$bin_race_dir/first.log" "$bin_race_dir/second.log";exit 1
fi
rg -q 'Bin selection changed' "$bin_race_dir/first.log" "$bin_race_dir/second.log"
docker exec -i "$bin_sql_container" psql -X -q -At -U postgres -d "$bin_sql_database" -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare t public.tasks;begin
 assert (select count(*)=1 from public.tasks where title='Concurrent Bin restore' and deleted_at is null);
 select * into t from public.tasks where title='Concurrent Bin restore';
 assert (select count(*)=1 from public.task_repeat_pending where series_id=t.series_id and not cancelled and generated_at is null);
 assert (select count(*)=1 from public.task_series where owner_id=t.owner_id and bin_restarted_from is not null);
end $$;
drop table public.local_bin_race;
SQL
echo 'PASS: concurrent Bin restores produce one resumed series and one future reservation; the stale request changes nothing'
