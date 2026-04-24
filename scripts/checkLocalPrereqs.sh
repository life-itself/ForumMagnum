#!/bin/bash

set -euo pipefail

failures=0

check_command() {
  local name="$1"
  local install_hint="$2"

  if command -v "$name" >/dev/null 2>&1; then
    echo "[ok] Found $name at $(command -v "$name")"
  else
    echo "[missing] $name"
    echo "         Install with: $install_hint"
    failures=$((failures + 1))
  fi
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[missing] node"
    echo "         Install Node.js >= 24.13.0"
    failures=$((failures + 1))
    return
  fi

  local raw_version major minor patch
  raw_version="$(node -v | sed 's/^v//')"
  IFS='.' read -r major minor patch <<< "$raw_version"

  if [[ "$major" -lt 24 ]] || ([[ "$major" -eq 24 ]] && [[ "$minor" -lt 13 ]]); then
    echo "[fail] node version $raw_version is below the required >= 24.13.0"
    failures=$((failures + 1))
  else
    echo "[ok] node version $raw_version"
  fi
}

echo "Checking local prerequisites for ForumMagnum hosted-DB development"

check_command brew "brew install <package>"
check_node_version
check_command psql "brew install libpq && echo 'export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\"' >> ~/.zshrc"
check_command railway "brew install railway"

if [[ "$failures" -gt 0 ]]; then
  echo
  echo "One or more prerequisites are missing."
  exit 1
fi

echo
echo "All local prerequisites are present."
