#!/usr/bin/env bash
# Uses an already-installed image; never pulls, exposes ports, or contacts Supabase.
set -euo pipefail
cd "$(dirname "$0")/../.."
docker image inspect postgres:16-alpine >/dev/null
task_sql_container="$(docker run --pull=never --rm -d --network none \
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
echo 'Local SQL checks passed; disposable database will now be removed.'
