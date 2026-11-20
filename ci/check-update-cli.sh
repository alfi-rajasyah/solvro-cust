#!/usr/bin/env bash
# Asserts the `solvro` command that setup.sh installs: setup.sh's update path
# writes it, and `solvro update` only runs a release's installer when that
# release is newer, fully published, confirmed, and its installer names the
# same version — backing up the database first. Runs against a `docker` shim
# with a throwaway $HOME: no daemon, no network, no root.
#
# Usage: ci/check-update-cli.sh          (from the repository root)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# The installer a release image carries: the real setup.sh with its tag set per
# scenario, and a longer CLI than the one running. The running CLI must survive
# being replaced mid-run (bash reads a script as it executes).
sed -E 's/^SOLVRO_IMAGE_TAG="[^"]*"$/SOLVRO_IMAGE_TAG="@TAG@"/' "$ROOT/setup.sh" \
  | awk '{ print } /^# on every update\)\.$/ { for (i = 0; i < 200; i++) print "# padding: a release whose CLI is longer" }' \
  > "$WORK/installer"
grep -q 'SOLVRO_IMAGE_TAG="@TAG@"' "$WORK/installer" && grep -q '^# padding' "$WORK/installer" \
  || { echo "update CLI checks FAILED (could not build the stand-in installer)"; exit 1; }

# docker shim. SHIM_STABLE = version the stable image reports; SHIM_FRONTEND_MISSING=1
# fails the frontend pull; SHIM_INSTALLER_TAG = tag inside the bundled installer;
# SHIM_RUNNING = image tag the running backend reports.
cat > "$WORK/bin/docker" <<'SHIM'
#!/usr/bin/env bash
echo "docker $*" >> "$SHIM_LOG"
case "$*" in
  pull*frontend*) [[ "${SHIM_FRONTEND_MISSING:-0}" == "1" ]] && exit 1 || exit 0 ;;
  "image inspect"*) echo "sha256:shim"; exit 0 ;;
  *"--entrypoint node"*) echo "${SHIM_STABLE}"; exit 0 ;;
  *"--entrypoint cat"*) sed "s/@TAG@/${SHIM_INSTALLER_TAG}/" "$SHIM_INSTALLER"; exit 0 ;;
  "compose ps"*) echo "ghcr.io/shim/solvro-cust-backend:${SHIM_RUNNING}"; exit 0 ;;
  "compose up"*) [[ "${SHIM_UP_FAIL:-0}" == "1" ]] && exit 1; exit 0 ;;
  *pg_dump*) [[ "${SHIM_PGDUMP_FAIL:-0}" == "1" ]] && exit 1; echo "PGDMP-shim"; exit 0 ;;
esac
exit 0
SHIM
chmod +x "$WORK/bin/docker"

FAILED=0
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILED=1; }

new_home() { # prints a fresh $HOME holding an existing install on $INSTALLED (default v1.1.0)
  local home="$WORK/home-$RANDOM"
  mkdir -p "$home/solvro"
  printf 'IMAGE_TAG=%s\nPOSTGRES_PASSWORD=x\nJWT_SECRET=x\nSECRETS_KEY=x\nBIND_ADDR=127.0.0.1\nFRONTEND_PORT=80\nBACKEND_PORT=3000\nAPP_URL="http://localhost"\n' "${INSTALLED:-v1.1.0}" > "$home/solvro/.env"
  printf '%s' "$home"
}

# --- setup.sh's update path installs the CLI
HOME_SETUP="$(new_home)"
HOME="$HOME_SETUP" PATH="$WORK/bin:$PATH" SHIM_LOG="$WORK/setup.log" \
  bash "$ROOT/setup.sh" </dev/null >"$WORK/setup.out" 2>&1
code=$?
if [[ $code -eq 0 && -x "$HOME_SETUP/solvro/bin/solvro" ]]; then pass "setup.sh update path writes ~/solvro/bin/solvro"; else fail "setup.sh update path (exit $code)"; cat "$WORK/setup.out"; fi
if [[ -L "$HOME_SETUP/.local/bin/solvro" || -L /usr/local/bin/solvro ]]; then pass "solvro is linked onto PATH"; else fail "solvro link missing"; fi
CLI="$HOME_SETUP/solvro/bin/solvro"
[[ -x "$CLI" ]] || { echo "update CLI checks FAILED (no CLI to test)"; exit 1; }

# run_cli <label> <stable> <installer tag> <frontend missing 0|1> <args...> -> "exit upgraded backups"
# "upgraded" = .env now pins the installer's tag. Each run uses its own copy of
# the installed CLI, which the installer replaces.
run_cli() {
  local label="$1" stable="$2" itag="$3" fmiss="$4"; shift 4
  local home log installed="${INSTALLED:-v1.1.0}"
  home="$(new_home)"; log="$WORK/cli-$label.log"; : > "$log"
  mkdir -p "$home/solvro/bin"; cp "$CLI" "$home/solvro/bin/solvro"
  # setsid: no controlling terminal, so a prompt cannot be answered.
  HOME="$home" PATH="$WORK/bin:$PATH" SHIM_LOG="$log" SHIM_STABLE="$stable" \
    SHIM_INSTALLER_TAG="$itag" SHIM_FRONTEND_MISSING="$fmiss" SHIM_INSTALLER="$WORK/installer" \
    SHIM_RUNNING="${RUNNING:-$installed}" SHIM_PGDUMP_FAIL="${PGDUMP_FAIL:-0}" \
    setsid bash "$home/solvro/bin/solvro" "$@" </dev/null >"$WORK/out-$label.log" 2>&1
  local code=$? ran=0 backups
  grep -qx "IMAGE_TAG=\"$itag\"" "$home/solvro/.env" && [[ "$itag" != "$installed" ]] && ran=1
  backups="$(find "$home/solvro/backups" -name '*.dump' 2>/dev/null | wc -l | tr -d ' ')"
  echo "$code $ran $backups"
}

check() { # check <label> <want "exit ran backups"> <got>
  if [[ "$3" == "$2" ]]; then pass "$1"; else fail "$1: want '$2', got '$3'"; sed 's/^/     /' "$WORK/out-$4.log" 2>/dev/null; fi
}

check "up to date: nothing runs"            "0 0 0" "$(run_cli same  1.1.0 v1.1.0 0 update --yes)" same
check "newer + --yes: backup, then install" "0 1 1" "$(run_cli newer 1.2.0 v1.2.0 0 update --yes)" newer
check "newer + --no-backup: install only"   "0 1 0" "$(run_cli nobak 1.2.0 v1.2.0 0 update --yes --no-backup)" nobak
check "no terminal, no --yes: refuses"      "1 0 0" "$(run_cli notty 1.2.0 v1.2.0 0 update)" notty
check "older stable: refuses downgrade"     "1 0 0" "$(run_cli older 1.0.9 v1.0.9 0 update --yes)" older
check "frontend unpublished: nothing runs"  "1 0 0" "$(run_cli fmiss 1.2.0 v1.2.0 1 update --yes)" fmiss
check "installer for another tag: not run"  "1 0 1" "$(run_cli itag  1.2.0 v1.3.0 0 update --yes)" itag
check "pinned release not running: says so" "1 0 0" "$(RUNNING=v1.0.0 run_cli notrun 1.1.0 v1.1.0 0 update --yes)" notrun
check "backup failure is an error"          "1 0 0" "$(PGDUMP_FAIL=1 run_cli bakfail 1.1.0 v1.1.0 0 backup)" bakfail
check "1.10.0 is newer than 1.9.0"          "0 1 1" "$(INSTALLED=v1.9.0 run_cli semver 1.10.0 v1.10.0 0 update --yes)" semver

# --- solvro config
# cfg <label> <args...> -> "exit <APP_URL in .env> <compose publishes 5433: 0|1> <compose up ran: 0|1>"
cfg() {
  local label="$1"; shift
  local home log
  home="$(new_home)"; log="$WORK/cfg-$label.log"; : > "$log"
  mkdir -p "$home/solvro/bin"; cp "$CLI" "$home/solvro/bin/solvro"
  printf 'POSTGRES_PORT=5433\n' >> "$home/solvro/.env"
  HOME="$home" PATH="$WORK/bin:$PATH" SHIM_LOG="$log" SHIM_UP_FAIL="${UP_FAIL:-0}" \
    setsid bash "$home/solvro/bin/solvro" config "$@" </dev/null >"$WORK/out-$label.log" 2>&1
  local code=$? app pg=0 up=0
  printf '%s' "$home" > "$WORK/home-$label"
  app="$(grep -E '^APP_URL=' "$home/solvro/.env" | tail -n 1 | cut -d= -f2- | tr -d '"')"
  grep -q '127.0.0.1:5433:5432' "$home/solvro/docker-compose.yml" 2>/dev/null && pg=1
  grep -qx 'docker compose up -d' "$log" && up=1
  echo "$code $app $pg $up"
}

check "config set APP_URL: saved and applied"    "0 https://solvro.acme.com 1 1" "$(cfg seturl set APP_URL=https://solvro.acme.com/)" seturl
check "config set bad APP_URL: nothing written"  "1 http://localhost 0 0"        "$(cfg badurl set APP_URL=https://x.example.com/path)" badurl
check "config set port clash: nothing written"   "1 http://localhost 0 0"        "$(cfg clash set FRONTEND_PORT=3000 APP_URL=https://ok.example.com)" clash
check "config set secret: refused"               "1 http://localhost 0 0"        "$(cfg secret set JWT_SECRET=x)" secret
check "config unset POSTGRES_PORT: unpublished"  "0 http://localhost 0 1"        "$(cfg unsetpg unset POSTGRES_PORT)" unsetpg
check "config unset a required setting: refused" "1 http://localhost 0 0"        "$(cfg unsetreq unset APP_URL)" unsetreq
check "config restart fails: previous restored"  "1 http://localhost 0 1"        "$(UP_FAIL=1 cfg upfail set APP_URL=https://solvro.acme.com)" upfail
check "config value with a line break: refused"  "1 http://localhost 0 0"        "$(cfg ctrl set "TRUST_PROXY=loopback,
uniquelocal")" ctrl
check "config show: no secrets printed"          "0 http://localhost 0 0"        "$(cfg show show)" show
check "config set ITOP_SYNC_DISABLED=maybe: refused" "1 http://localhost 0 0"    "$(cfg itopbad set ITOP_SYNC_DISABLED=maybe)" itopbad
if grep -q '^ITOP_SYNC_DISABLED=' "$(cat "$WORK/home-itopbad")/solvro/.env"; then fail "ITOP_SYNC_DISABLED=maybe was written"; fi
check "config set ITOP_SYNC_DISABLED=true: saved"    "0 http://localhost 1 1"    "$(cfg itopok set ITOP_SYNC_DISABLED=true)" itopok
if grep -qx 'ITOP_SYNC_DISABLED="true"' "$(cat "$WORK/home-itopok")/solvro/.env"; then pass "ITOP_SYNC_DISABLED saved as a quoted value"; else fail "ITOP_SYNC_DISABLED not saved as ITOP_SYNC_DISABLED=\"true\""; fi
if grep -q 'POSTGRES_PASSWORD\|JWT_SECRET\|SECRETS_KEY' "$WORK/out-show.log"; then fail "config show printed a secret"; fi

if [[ $FAILED -ne 0 ]]; then
  echo "update CLI checks FAILED"
  exit 1
fi
echo "update CLI checks passed"
