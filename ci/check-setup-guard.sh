#!/usr/bin/env bash
# Asserts that setup.sh's fresh-install branch never deletes an existing
# `solvro_pgdata` volume by accident. The installer is run for real, with a
# throwaway $HOME and a `docker` shim on PATH that records every call and
# pretends (per scenario) that the volume does or does not exist. No Docker
# daemon, no network and no root are needed.
#
#   volume exists, no FORCE_FRESH   -> exit 1, no `volume rm`, no file written
#   volume exists, FORCE_FRESH=1    -> `volume rm` runs (explicit wipe)
#   volume absent                   -> `volume rm` runs (genuinely fresh server)
#   daemon unreachable              -> exit 1, nothing written (not read as "no volume")
#
# Usage: ci/check-setup-guard.sh          (from the repository root)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# docker shim: log the call; `volume inspect` answers per SHIM_VOLUME_EXISTS.
cat > "$WORK/bin/docker" <<'SHIM'
#!/usr/bin/env bash
echo "docker $*" >> "$SHIM_LOG"
case "$1 ${2:-}" in
  "info ")          [[ "${SHIM_DAEMON_DOWN:-0}" == "1" ]] && exit 1 || exit 0 ;;
  "volume inspect") [[ "${SHIM_VOLUME_EXISTS:-0}" == "1" ]] && exit 0 || exit 1 ;;
  "compose exec")   echo "Admin user ready (shim)"; exit 0 ;;
esac
exit 0
SHIM
# curl shim: the readiness probe succeeds at once.
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/curl"
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"

FAILED=0

# run <label> <volume-exists 0|1> <force-fresh "" | 1> [daemon-down 0|1]
run() {
  local label="$1" exists="$2" force="$3" down="${4:-0}"
  local home="$WORK/home-$RANDOM" log="$WORK/calls-$RANDOM.log"
  mkdir -p "$home"; : > "$log"
  # Every prompt has a value so no read from /dev/tty is attempted.
  HOME="$home" PATH="$WORK/bin:$PATH" SHIM_LOG="$log" SHIM_VOLUME_EXISTS="$exists" SHIM_DAEMON_DOWN="$down" \
    FORCE_FRESH="$force" \
    ADMIN_EMAIL=ci@example.com ADMIN_PASSWORD=ci-password-1234 \
    BIND_ADDR=127.0.0.1 FRONTEND_PORT=80 BACKEND_PORT=3000 POSTGRES_PORT=5432 \
    APP_URL=http://localhost EMBED_FRAME_ANCESTORS=https://docs.example.com \
    bash "$ROOT/setup.sh" </dev/null >"$WORK/out-$label.log" 2>&1
  local code=$?
  [[ -e "$home/solvro/docker-compose.yml" ]] && cp "$home/solvro/docker-compose.yml" "$WORK/compose-$label.yml"
  [[ -e "$home/solvro/.env" ]] && cp "$home/solvro/.env" "$WORK/env-$label"
  local removed=0; grep -q "^docker volume rm solvro_pgdata$" "$log" && removed=1
  local wrote=0; [[ -e "$home/solvro/.env" ]] && wrote=1
  echo "$code $removed $wrote"
}

check() { # check <label> <want exit> <want removed> <want wrote> <got "exit removed wrote">
  local label="$1" want="$2 $3 $4" got="$5"
  if [[ "$got" == "$want" ]]; then
    echo "ok   $label (exit/removed/wrote = $got)"
  else
    echo "FAIL $label: want exit/removed/wrote = $want, got $got"
    sed 's/^/  | /' "$WORK/out-$label.log" | tail -n 15
    FAILED=1
  fi
}

check "volume-exists-refuses"      1 0 0 "$(run volume-exists-refuses 1 "")"
check "volume-exists-force-wipes"  0 1 1 "$(run volume-exists-force-wipes 1 1)"
check "no-volume-fresh-wipes"      0 1 1 "$(run no-volume-fresh-wipes 0 "")"
check "daemon-down-refuses"        1 0 0 "$(run daemon-down-refuses 0 "" 1)"

# The compose file a fresh install writes must keep the API local-only and
# carry the hygiene blocks (health check, log rotation, proxy trust).
compose="$WORK/compose-no-volume-fresh-wipes.yml"
compose_has() { # compose_has <label> <fixed string>
  if grep -qF -- "$2" "$compose"; then echo "ok   compose: $1"; else echo "FAIL compose: $1 (missing: $2)"; FAILED=1; fi
}
compose_lacks() {
  if grep -qF -- "$2" "$compose"; then echo "FAIL compose: $1 (present: $2)"; FAILED=1; else echo "ok   compose: $1"; fi
}
compose_has   "API bound to 127.0.0.1"      '"127.0.0.1:${BACKEND_PORT:-3000}:3000"'
compose_lacks "API never bound to BIND_ADDR" '${BIND_ADDR:-127.0.0.1}:${BACKEND_PORT:-3000}'
compose_has   "proxy trust default"         'TRUST_PROXY: "${TRUST_PROXY:-loopback, uniquelocal}"'
compose_has   "CORS from APP_URL"           'CORS_ORIGIN: "${APP_URL:-*}"'
compose_has   "backend health check"        "fetch('http://127.0.0.1:3000/health')"
compose_has   "frontend waits for health"   "condition: service_healthy"
compose_has   "log rotation"                'max-size: "10m"'
compose_has   "image tag pinned from .env"  'solvro-cust-backend:${IMAGE_TAG}'
compose_lacks "no pull_policy always"       'pull_policy'
if grep -qE '^IMAGE_TAG=v[0-9]+\.[0-9]+\.[0-9]+$' "$WORK/env-no-volume-fresh-wipes"; then
  echo "ok   .env: IMAGE_TAG pinned ($(grep '^IMAGE_TAG=' "$WORK/env-no-volume-fresh-wipes"))"
else
  echo "FAIL .env: IMAGE_TAG missing or not a release tag"; FAILED=1
fi

if [[ $FAILED -ne 0 ]]; then
  echo "setup.sh guard checks FAILED"
  exit 1
fi
echo "setup.sh guard checks passed"
