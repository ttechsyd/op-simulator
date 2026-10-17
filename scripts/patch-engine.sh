#!/usr/bin/env bash
# Engine fixes upstream hasn't taken live in patches/ and go onto the submodule's working
# tree before it builds. Safe to re-run: a patch that is already in is skipped.
set -euo pipefail
cd "$(dirname "$0")/.."

for p in patches/*.patch; do
  if git -C tcg-engines apply --check --reverse --ignore-whitespace "../$p" 2>/dev/null; then
    echo "already applied: $p"
  else
    git -C tcg-engines apply --ignore-whitespace "../$p"
    echo "applied: $p"
  fi
done
