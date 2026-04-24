#!/bin/bash

set -euo pipefail

if [[ -d "/opt/homebrew/opt/libpq/bin" ]]; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not installed."
  echo "Install with: brew install libpq"
  echo "Then add to PATH, for example:"
  echo "  export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\""
  exit 1
fi

if [[ -z "${PG_URL:-}" ]]; then
  echo "PG_URL is required."
  exit 1
fi

echo "Checking PostgreSQL connectivity..."
psql "$PG_URL" -v ON_ERROR_STOP=1 -c 'select version();'

echo
echo "Checking pgvector availability..."
psql "$PG_URL" -v ON_ERROR_STOP=1 -c 'create extension if not exists vector;'

echo
echo "Hosted database connectivity looks good."
