#!/usr/bin/env bash
# One release number everywhere: VERSION (vX.Y.Z), backend/package.json,
# frontend/package.json (the login page shows it) and the image tag setup.sh
# pins (SOLVRO_IMAGE_TAG, vX.Y.Z). Run from the repository root.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
want="$(tr -d '[:space:]' < "$ROOT/VERSION")"
want="${want#v}"
fail=0
check() { # check <label> <value>
  if [[ "$2" == "$want" ]]; then echo "ok   $1 = $2"; else echo "FAIL $1 = $2 (VERSION says $want)"; fail=1; fi
}
check "backend/package.json"  "$(node -p "require('$ROOT/backend/package.json').version")"
check "frontend/package.json" "$(node -p "require('$ROOT/frontend/package.json').version")"
tag="$(sed -nE 's/^SOLVRO_IMAGE_TAG="v?([^"]+)"$/\1/p' "$ROOT/setup.sh")"
check "setup.sh SOLVRO_IMAGE_TAG" "$tag"
if [[ $fail -ne 0 ]]; then echo "version check FAILED"; exit 1; fi
echo "version check passed ($want)"
