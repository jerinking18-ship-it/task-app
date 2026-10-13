#!/usr/bin/env bash
# Uses an already-installed image; never pulls, exposes ports, or contacts Supabase.
set -euo pipefail
cd "$(dirname "$0")/../.."
docker image inspect postgres:16-alpine >/dev/null
task_sql_container="$(docker run --pull=never --rm -d --network none \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)"
trap 'docker rm -f "$task_sql_container" >/dev/null 2>&1 || true' EXIT
for task_sql_attempt in {1..30}; do
  if docker exec "$task_sql_container" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$task_sql_container" pg_isready -U postgres >/dev/null
for task_sql_file in \
  supabase/tests/local-bootstrap.sql \
  supabase/migrations/202610120001_private_tasks_categories.sql \
  supabase/verification/20261012_schema_checks.sql \
  supabase/migrations/202610120002_account_timezone.sql \
  supabase/verification/20261012_timezone_schema_checks.sql \
  supabase/tests/private_tasks_categories.sql \
  supabase/tests/account_timezone.sql; do
  docker exec -i "$task_sql_container" psql -X -q -At -U postgres \
    -v ON_ERROR_STOP=1 < "$task_sql_file"
done
# Exercise the new migration on a separate fresh database with legacy fixtures.
docker exec "$task_sql_container" createdb -U postgres meeting_feature_tests
docker exec "$task_sql_container" mkdir -p /tmp/supabase/tests /tmp/supabase/migrations
for task_sql_file in \
  supabase/tests/meeting_task_features.sql \
  supabase/migrations/202610120001_private_tasks_categories.sql \
  supabase/migrations/202610120002_account_timezone.sql \
  supabase/migrations/202610120003_task_weekdays_and_deletion.sql; do
  docker cp "$task_sql_file" "$task_sql_container:/tmp/$task_sql_file"
done
docker exec -w /tmp "$task_sql_container" psql -X -q -At -U postgres \
  -d meeting_feature_tests -f supabase/tests/meeting_task_features.sql
for task_sql_file in \
  supabase/migrations/202610120004_repeat_history.sql \
  supabase/verification/20261012_repeat_schema_checks.sql \
  supabase/tests/repeat_history.sql \
  supabase/tests/repeat_atomicity.sql; do
  docker exec -i "$task_sql_container" psql -X -q -At -U postgres \
    -d meeting_feature_tests -v ON_ERROR_STOP=1 < "$task_sql_file"
done
bash supabase/tests/repeat_concurrency.sh "$task_sql_container"
for task_sql_file in \
  supabase/tests/repeat_midnight_transition.sql \
  supabase/migrations/202610120005_midnight_repeats.sql \
  supabase/verification/20261012_midnight_repeat_schema_checks.sql \
  supabase/tests/repeat_midnight.sql; do
  docker exec -i "$task_sql_container" psql -X -q -At -U postgres \
    -d meeting_feature_tests -v ON_ERROR_STOP=1 < "$task_sql_file"
done
bash supabase/tests/repeat_midnight_concurrency.sh "$task_sql_container"
for task_sql_file in \
  supabase/tests/shared_members_transition.sql \
  supabase/migrations/202610130006_shared_members.sql \
  supabase/verification/20261013_members_schema_checks.sql \
  supabase/tests/shared_members.sql; do
  docker exec -i "$task_sql_container" psql -X -q -At -U postgres \
    -d meeting_feature_tests -v ON_ERROR_STOP=1 < "$task_sql_file"
done
bash supabase/tests/shared_members_concurrency.sh "$task_sql_container"
for task_sql_file in \
  supabase/migrations/202610130007_member_profiles.sql \
  supabase/verification/20261013_member_profiles_schema_checks.sql \
  supabase/tests/member_profiles.sql; do
  docker exec -i "$task_sql_container" psql -X -q -At -U postgres \
    -d meeting_feature_tests -v ON_ERROR_STOP=1 < "$task_sql_file"
done
echo 'Local SQL checks passed; disposable database will now be removed.'
