#!/usr/bin/env bash
# DISPOSABLE PostgreSQL ONLY; called by run-local.sh, never a hosted database.
set -euo pipefail
template_container="$1"
template_logs="$(mktemp -d)"
trap 'rm -rf "$template_logs"' EXIT
template_prefix="set request.jwt.claim.sub='00000000-0000-4000-8000-000000000941';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000942';set role authenticated;"
docker exec -i "$template_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id) values('00000000-0000-4000-8000-000000000941');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000942','00000000-0000-4000-8000-000000000941');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000941';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000000942';set role authenticated;
select public.task_app_choose_member(null,'Template Race')->'current'->>'name';
SQL
template_create="select public.task_app_save_template('00000000-0000-4000-8000-000000000943',null,'Race set','[{\"title\":\"Race task\",\"notes\":\"\"}]')->>'id';"
for template_worker in 1 2;do
 docker exec "$template_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$template_prefix$template_create" > "$template_logs/create-$template_worker" 2>&1 &
done
wait
# Both identical creates succeed but only one durable row exists.
for template_worker in 1 2;do rg -q '^00000000-0000-4000-8000-000000000943$' "$template_logs/create-$template_worker";done
template_version="$(docker exec "$template_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select updated_at from public.task_templates where id='00000000-0000-4000-8000-000000000943'")"
for template_worker in 1 2;do
 (set +e;docker exec "$template_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$template_prefix select public.task_app_save_template('00000000-0000-4000-8000-000000000943','$template_version','Race $template_worker','[{\"title\":\"Race task\",\"notes\":\"\"}]')->>'name';" > "$template_logs/update-$template_worker" 2>&1;echo "$?" > "$template_logs/status-$template_worker") &
done
wait
template_successes=0
for template_worker in 1 2;do
 if [[ "$(cat "$template_logs/status-$template_worker")" == 0 ]];then template_successes=$((template_successes+1));else rg -q 'Template changed' "$template_logs/update-$template_worker";fi
done
[[ "$template_successes" == 1 ]]
docker exec -i "$template_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin assert (select count(*) from public.task_templates where id='00000000-0000-4000-8000-000000000943')=1;end $$;
delete from auth.users where id='00000000-0000-4000-8000-000000000941';
SQL
echo 'PASS: concurrent identical template creates save once; concurrent edits accept one and reject the stale draft'
