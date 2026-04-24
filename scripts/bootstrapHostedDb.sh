#!/bin/bash

set -euo pipefail

if [[ -d "/opt/homebrew/opt/libpq/bin" ]]; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not installed."
  exit 1
fi

if [[ -z "${PG_URL:-}" ]]; then
  echo "PG_URL is required."
  exit 1
fi

if [[ ! -x "node_modules/.bin/ts-node" ]]; then
  echo "Project dependencies are required before running migrations."
  echo "Run: yarn install"
  exit 1
fi

schema_is_loaded() {
  psql "$PG_URL" -tA -c "select to_regclass('public.\"ArbitalCaches\"') is not null;"
}

migration_log_count() {
  psql "$PG_URL" -tA -c "select count(*) from migration_log;" 2>/dev/null || echo "missing"
}

if [[ "$(schema_is_loaded)" == "t" ]]; then
  echo "Accepted schema already present; skipping schema import."
  log_count="$(migration_log_count)"

  if [[ "$log_count" == "missing" || "$log_count" == "0" ]]; then
    echo
    echo "Migration log is empty; marking schema-backed migrations as executed..."
    PG_URL="$PG_URL" ENV_NAME=stage1Lw FORUM_TYPE=LessWrong ./node_modules/.bin/ts-node -r tsconfig-paths/register --swc --project tsconfig-repl.json ./scripts/markSchemaMigrationsExecuted.ts
  else
    echo
    echo "Running repo migrations against existing hosted database..."
    SKIP_VERCEL_CODE_PULL=true ENV_NAME=localLwDevDb FORUM_TYPE=LessWrong PG_URL="$PG_URL" yarn migrate up dev lw
  fi
else
  echo "Loading accepted schema into hosted database..."
  psql "$PG_URL" -v ON_ERROR_STOP=1 -f ./schema/accepted_schema.sql

  echo
  echo "Marking schema-backed migrations as executed..."
  PG_URL="$PG_URL" ENV_NAME=stage1Lw FORUM_TYPE=LessWrong ./node_modules/.bin/ts-node -r tsconfig-paths/register --swc --project tsconfig-repl.json ./scripts/markSchemaMigrationsExecuted.ts
fi
