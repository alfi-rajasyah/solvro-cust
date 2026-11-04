#!/usr/bin/env bash
# Asserts how a fresh setup.sh install derives its network settings from the
# address people open (APP_URL), and that a setting given as an env var still
# wins. Runs the installer for real against a `docker` shim with a throwaway
# $HOME and no terminal: no daemon, no network, no root.
#
# Usage: ci/check-setup-install.sh          (from the repository root)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

cat > "$WORK/bin/docker" <<'SHIM'
#!/usr/bin/env bash
case "$1 ${2:-}" in
  "volume inspect") exit 1 ;;
  "compose exec")   echo "Admin user ready (shim)"; exit 0 ;;
esac
exit 0
SHIM
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/curl"
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"

FAILED=0

# install <label> [VAR=value ...] [-- setup.sh args] -> "exit BIND_ADDR FRONTEND_PORT APP_URL"
install() {
  local label="$1"; shift
  local -a envs=() args=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && { shift; args=("$@"); }
  local home="$WORK/home-$label"
  mkdir -p "$home"
  env HOME="$home" PATH="$WORK/bin:$PATH" ADMIN_EMAIL=ci@example.com ADMIN_PASSWORD=ci-password-1234 \
    "${envs[@]}" setsid bash "$ROOT/setup.sh" "${args[@]}" </dev/null >"$WORK/out-$label.log" 2>&1
  local code=$?
  get() { grep -E "^$1=" "$home/solvro/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'; }
  echo "$code $(get BIND_ADDR) $(get FRONTEND_PORT) $(get APP_URL)"
}

check() { # check <label> <want> <got>
  if [[ "$3" == "$2" ]]; then echo "ok   $1"; else echo "FAIL $1: want '$2', got '$3'"; sed 's/^/     /' "$WORK/out-$4.log"; FAILED=1; fi
}

check "no address: this server only, port 80"   "0 127.0.0.1 80 http://localhost" \
  "$(install none)" none
check "https: behind a proxy on 127.0.0.1:8090"  "0 127.0.0.1 8090 https://solvro.example.com" \
  "$(install tls APP_URL=https://solvro.example.com)" tls
check "http host:port: on the network"           "0 0.0.0.0 8080 http://10.0.0.5:8080" \
  "$(install lan APP_URL=http://10.0.0.5:8080)" lan
check "env var wins over the derived value"      "0 127.0.0.1 9000 https://solvro.example.com" \
  "$(install envwins APP_URL=https://solvro.example.com FRONTEND_PORT=9000)" envwins
check "BIND_ADDR/FRONTEND_PORT only: address built from them" "0 127.0.0.1 8090 http://localhost:8090" \
  "$(install envonly BIND_ADDR=127.0.0.1 FRONTEND_PORT=8090)" envonly
check "capitalised LOCALHOST stays local"         "0 127.0.0.1 80 http://LOCALHOST" \
  "$(install upper APP_URL=http://LOCALHOST)" upper
check "address on :3000 moves the API aside"      "0 0.0.0.0 3000 http://10.0.0.5:3000 3001" \
  "$(install p3000 APP_URL=http://10.0.0.5:3000) $(grep -E '^BACKEND_PORT=' "$WORK/home-p3000/solvro/.env" | cut -d= -f2)" p3000
check "--advanced, no terminal: old defaults"     "0 127.0.0.1 80 http://localhost" \
  "$(install adv -- --advanced)" adv
check "bad address is refused"                    "1   " \
  "$(install bad APP_URL=https://solvro.example.com/path)" bad
check "unknown option is refused"                 "1   " \
  "$(install opt -- --nope)" opt

if [[ $FAILED -ne 0 ]]; then
  echo "setup.sh install checks FAILED"
  exit 1
fi
echo "setup.sh install checks passed"
