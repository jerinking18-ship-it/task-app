#!/usr/bin/env bash
# Offline disposable PostgreSQL ONLY. No network/hosted data.
set -euo pipefail
template_bin_container="$1"
template_bin_logs="$(mktemp -d)"
trap 'rm -rf "$template_bin_logs"' EXIT
template_bin_prefix="set request.jwt.claim.sub='00000000-0000-4000-8000-000000001091';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001092';set role authenticated;"
docker exec -i "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id) values('00000000-0000-4000-8000-000000001091');
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000001092','00000000-0000-4000-8000-000000001091');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000001091';set request.jwt.claim.session_id='00000000-0000-4000-8000-000000001092';set role authenticated;
select public.task_app_choose_member(null,'Template Bin Race')->'current'->>'name';
select public.task_app_save_template('00000000-0000-4000-8000-000000001093',null,'Race','[{"title":"Original task","notes":"Preserve notes"}]')->>'name';
reset role;
insert into public.tasks(id,title) values('00000000-0000-4000-8000-000000001094','Race copied task');
SQL
template_bin_version="$(docker exec "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select updated_at from public.task_templates where id='00000000-0000-4000-8000-000000001093'")"
template_bin_save="select public.task_app_save_template('00000000-0000-4000-8000-000000001093','$template_bin_version','Edited','[{\"title\":\"Original task\",\"notes\":\"Preserve notes\"}]');"
template_bin_remove="select public.task_app_remove_template('00000000-0000-4000-8000-000000001093','$template_bin_version',true);"
for template_bin_worker in 1 2; do
 template_bin_sql="$template_bin_save";[[ "$template_bin_worker" == 2 ]]&&template_bin_sql="$template_bin_remove"
 (set +e;docker exec "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$template_bin_prefix $template_bin_sql" > "$template_bin_logs/edit-$template_bin_worker" 2>&1;echo "$?" > "$template_bin_logs/status-$template_bin_worker") &
done
wait
template_bin_success=0
for template_bin_worker in 1 2;do if [[ "$(cat "$template_bin_logs/status-$template_bin_worker")" == 0 ]];then template_bin_success=$((template_bin_success+1));else rg -q 'Template (changed|is in Bin)' "$template_bin_logs/edit-$template_bin_worker";fi;done
[[ "$template_bin_success" == 1 ]]
docker exec -i "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<SQL
$template_bin_prefix
do \$\$declare t public.task_templates;s public.tasks;begin
 select * into t from public.task_templates where id='00000000-0000-4000-8000-000000001093';
 if t.id is not null then perform public.task_app_remove_template(t.id,t.updated_at,true);end if;
 select * into s from public.tasks where id='00000000-0000-4000-8000-000000001094';perform public.task_app_mutate(s.id,s.updated_at,'delete');
end\$\$;
SQL
template_bin_version="$(docker exec "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select updated_at from public.task_templates where id='00000000-0000-4000-8000-000000001093'")"
template_bin_task_version="$(docker exec "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -c "select updated_at from public.tasks where id='00000000-0000-4000-8000-000000001094'")"
template_bin_restore="select public.task_app_bin_items('restore','[{\"kind\":\"task\",\"id\":\"00000000-0000-4000-8000-000000001094\",\"version\":\"$template_bin_task_version\"},{\"kind\":\"template\",\"id\":\"00000000-0000-4000-8000-000000001093\",\"version\":\"$template_bin_version\"}]',true);"
template_bin_purge="select public.task_app_bin_items('purge','[{\"kind\":\"template\",\"id\":\"00000000-0000-4000-8000-000000001093\",\"version\":\"$template_bin_version\"}]',true);"
for template_bin_worker in 1 2; do
 template_bin_sql="$template_bin_restore";[[ "$template_bin_worker" == 2 ]]&&template_bin_sql="$template_bin_purge"
 (set +e;docker exec "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 -c "$template_bin_prefix $template_bin_sql" > "$template_bin_logs/mixed-$template_bin_worker" 2>&1;echo "$?" > "$template_bin_logs/status-$template_bin_worker") &
done
wait
template_bin_success=0
for template_bin_worker in 1 2;do if [[ "$(cat "$template_bin_logs/status-$template_bin_worker")" == 0 ]];then template_bin_success=$((template_bin_success+1));else rg -q 'Bin selection changed' "$template_bin_logs/mixed-$template_bin_worker";fi;done
[[ "$template_bin_success" == 1 ]]
docker exec -i "$template_bin_container" psql -X -q -At -U postgres -d meeting_feature_tests -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 assert (exists(select 1 from public.task_templates where id='00000000-0000-4000-8000-000000001093' and deleted_at is null)
  and exists(select 1 from public.tasks where id='00000000-0000-4000-8000-000000001094' and deleted_at is null))
 or (not exists(select 1 from public.task_templates where id='00000000-0000-4000-8000-000000001093')
  and exists(select 1 from public.tasks where id='00000000-0000-4000-8000-000000001094' and deleted_at is not null));
end$$;
delete from public.tasks where owner_id='00000000-0000-4000-8000-000000001091';
delete from auth.users where id='00000000-0000-4000-8000-000000001091';
SQL
echo 'PASS: edit/removal race accepts one version; mixed restore/template purge race cannot partly change tasks or lose notes'
