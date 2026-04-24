#!/bin/bash

set -euo pipefail

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
fi

if [[ -z "${PG_URL:-}" ]]; then
  echo "PG_URL is required."
  exit 1
fi

if [[ -z "${ENV_NAME:-}" ]]; then
  echo "ENV_NAME is required."
  exit 1
fi

if [[ -z "${private_expressSessionSecret:-}" ]]; then
  echo "private_expressSessionSecret is required."
  exit 1
fi

if [[ -z "${FORUM_TYPE:-}" ]]; then
  export FORUM_TYPE="LessWrong"
fi

if [[ -z "${PORT:-}" ]]; then
  export PORT=8080
fi

if [[ ! -d ".next" ]]; then
  echo "A production build is required before starting."
  echo "Run: yarn build-hosted-db"
  exit 1
fi

echo "Starting ForumMagnum hosted runtime"
echo "  ENV_NAME=$ENV_NAME"
echo "  FORUM_TYPE=$FORUM_TYPE"
echo "  PORT=$PORT"

NODE_OPTIONS="${NODE_OPTIONS:---no-deprecation --max_old_space_size=2560}" ./node_modules/.bin/next start --port "$PORT"
