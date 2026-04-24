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

if [[ ! -x "node_modules/.bin/next" ]]; then
  echo "Project dependencies are required before building."
  echo "Run: yarn install"
  exit 1
fi

echo "Building ForumMagnum with hosted DB config"
echo "  ENV_NAME=$ENV_NAME"
echo "  FORUM_TYPE=$FORUM_TYPE"

yarn generate
NODE_OPTIONS="${NODE_OPTIONS:---no-deprecation --max_old_space_size=2560}" ./node_modules/.bin/next build
