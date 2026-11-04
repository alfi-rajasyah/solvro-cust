#!/usr/bin/env bash
# Solvro one-shot deploy script.
#
# First run on a fresh server:
#   - Prompts for an admin email + password
#   - Prompts for the host ports (website / API / optional Postgres), each
#     with a default you can accept by pressing Enter
#   - Generates random POSTGRES_PASSWORD and JWT_SECRET
#   - Writes ~/solvro/{docker-compose.yml,.env}
#   - Wipes any prior solvro_pgdata volume (clears stale postgres state) —
#     but refuses when that volume already exists unless FORCE_FRESH=1 is
#     set, because a missing ~/solvro/.env on a server with data (lost file,
#     or a run as another Unix user) must not destroy the database
#   - Brings the stack up and creates the admin user
#
# Re-runs on a server that already has ~/solvro/.env:
#   - Detects existing install, skips prompts
#   - Reuses the ports from ~/solvro/.env, pins IMAGE_TAG to this script's
#     release, pulls those images, restarts
#
# Both paths install the `solvro` command (~/solvro/bin/solvro, linked onto
# PATH). `solvro update` upgrades to the newest tagged release by running the
# setup.sh that release's backend image carries — the same update path.
#
# Host binding + ports (set as env vars or answer the prompts):
#   BIND_ADDR       interface   (default 127.0.0.1 = local-only: reach it
#                                from the server or an SSH tunnel only.
#                                0.0.0.0 = all interfaces / on the network;
#                                or a specific LAN IP. Applies to website +
#                                API; Postgres always stays on 127.0.0.1.)
#   FRONTEND_PORT   website     (default 80)
#   BACKEND_PORT    API         (default 3000; always bound to 127.0.0.1 —
#                                the website's nginx reaches the API inside
#                                the compose network, so nothing else needs it)
#   POSTGRES_PORT   database    (default: NOT published — stays private)
#   TRUST_PROXY     which proxies the API believes for the client IP (default
#                   "loopback, uniquelocal" = the bundled nginx on the compose
#                   network plus a TLS front or tunnel on this host; a hop
#                   count such as 2 also works). Saved to .env when set.
#   APP_URL         the public address users reach Solvro on (a bare http(s)
#                   origin, e.g. https://solvro.acme.com). The backend builds
#                   the Outline OAuth redirect / webhook URLs from it. Prompted
#                   on a fresh install (default: the bind address + website
#                   port); saved to .env. On a re-run, pass it in the
#                   environment to change it (older installs get the default).
#   EMBED_FRAME_ANCESTORS  Outline address(es) allowed to embed Solvro pages in
#                   an iframe (space-separated http(s) origins, e.g.
#                   https://docs.acme.com). Default empty = embedding off.
#                   Saved to .env when set; on a re-run, pass it in the
#                   environment to change it.
# To change BIND_ADDR / frontend / backend later, edit ~/solvro/.env and
# `docker compose up -d`. Changing whether/where Postgres is published
# requires re-running this script.
#
# Requirements: Docker Engine + Docker Compose plugin already installed.

set -euo pipefail

DEPLOY_DIR="$HOME/solvro"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/.env"
VOLUME_NAME="solvro_pgdata"
# The release this installer belongs to — the image tag it pins in
# ~/solvro/.env (IMAGE_TAG). Bumped with VERSION on every release
# (ci/check-version.sh keeps them equal). A newer setup.sh is the upgrade
# (`solvro update` fetches and runs it): it rewrites IMAGE_TAG and pulls; a
# plain `docker compose pull` / `up -d` never changes the release.
SOLVRO_IMAGE_TAG="v1.1.0"

# ------------------------------------------------------------------ options
ADVANCED=0
for arg in "$@"; do
  case "$arg" in
    --advanced) ADVANCED=1 ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash setup.sh [--advanced]

Installs Solvro in ~/solvro, or upgrades an existing install.

A fresh install asks for the admin account and the address people will open
Solvro at; the network settings follow from that address. --advanced asks for
every setting instead (ports, bind address, Postgres, Outline embedding).
Any setting can also be given as an environment variable (see INSTALL.md).
USAGE
      exit 0 ;;
    *) echo "ERROR: unknown option '$arg' (see: bash setup.sh --help)."; exit 1 ;;
  esac
done

# ------------------------------------------------------------------ checks
command -v docker >/dev/null 2>&1 || {
  echo "ERROR: Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "ERROR: Docker Compose plugin missing. Install docker-compose-plugin."
  exit 1
}
command -v openssl >/dev/null 2>&1 || {
  echo "ERROR: openssl is required to generate secrets."
  exit 1
}

mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# ------------------------------------------------------------------ helpers

# True when a terminal can actually be opened for prompts. A readable
# /dev/tty node is not enough: it exists even without a controlling terminal (cron,
# CI, setsid), and the first prompt would then fail instead of taking defaults.
have_tty() {
  { : </dev/tty; } 2>/dev/null
}

# Valid TCP port: integer 1-65535. 10# forces base-10 so leading zeros
# (e.g. "08") don't get misread as octal.
is_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 ))
}

# Valid IPv4 dotted-quad, each octet 0-255. Rejects hostnames / IPv6.
is_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local IFS=. octet
  for octet in $1; do
    (( 10#$octet >= 0 && 10#$octet <= 255 )) || return 1
  done
  return 0
}

# Light check of TRUST_PROXY: a hop count 0-10, or a comma list of
# loopback / linklocal / uniquelocal / IPv4 / IPv6 addresses or CIDRs. The
# backend (src/http/trustProxy.ts) validates it fully; this only fails early.
is_trust_proxy() {
  local value="$1" entry
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    (( 10#$value <= 10 ))
    return
  fi
  local IFS=,
  for entry in $value; do
    entry="${entry//[[:space:]]/}"
    [[ "$entry" =~ ^(loopback|linklocal|uniquelocal)$ \
      || "$entry" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$ \
      || "$entry" =~ ^[0-9a-fA-F:.]*:[0-9a-fA-F:.]*(/[0-9]{1,3})?$ ]] || return 1
  done
  return 0
}

# One bare http(s) origin (scheme://host[:port], one trailing "/" tolerated):
# prints it without the slash and returns 0, or returns 1. No path, query,
# login, wildcard or other character may pass: the value ends up in a response
# header (EMBED_FRAME_ANCESTORS) or in OAuth redirect URLs (APP_URL).
normalise_origin() {
  local LC_ALL=C tok="${1%/}"
  [[ "$tok" =~ ^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]] || return 1
  printf '%s' "$tok"
}

# Normalises EMBED_FRAME_ANCESTORS-style input: whitespace/comma separated
# http(s) origins -> single-space list. Prints the result and returns 0, or
# returns 1 on any entry that is not a plain origin or a list over 2000 chars.
# The frontend container re-validates the value at start (fail closed), so this
# only fails early with a clear message.
normalise_frame_origins() {
  local LC_ALL=C out="" tok one
  (( ${#1} <= 2000 )) || return 1
  set -f
  for tok in ${1//,/ }; do
    one="$(normalise_origin "$tok")" || { set +f; return 1; }
    out="${out:+$out }$one"
  done
  set +f
  printf '%s' "$out"
}

# Reads KEY from ~/solvro/.env WITHOUT sourcing it (a hand-edited, unquoted
# value with spaces would otherwise be executed as a command): last assignment,
# one pair of surrounding quotes removed. Prints nothing when absent.
env_file_get() {
  local line
  line="$(grep -E "^${1}=" "$ENV_FILE" | tail -n 1)" || true
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

# Sets KEY="VALUE" (quoted) in ~/solvro/.env, replacing any earlier line for
# KEY. VALUE must already be validated (no quotes or shell metacharacters).
env_file_set() {
  local tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  grep -v "^${1}=" "$ENV_FILE" > "$tmp" || true
  printf '%s="%s"\n' "$1" "$2" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

# URL for the success/update message, from BIND_ADDR + FRONTEND_PORT.
# 127.0.0.1 -> localhost (loopback only); 0.0.0.0 -> the server's primary
# IP (reachable on the network); a specific IP -> that IP. The :port
# suffix is dropped when the website is on 80.
app_url() {
  local host
  case "${BIND_ADDR:-127.0.0.1}" in
    127.0.0.1) host="localhost" ;;
    0.0.0.0)
      host="$(hostname -I 2>/dev/null | awk '{print $1}')"
      [[ -z "$host" ]] && host="<server-ip>"
      ;;
    *) host="${BIND_ADDR}" ;;
  esac
  if [[ "${FRONTEND_PORT:-80}" == "80" ]]; then
    echo "http://${host}"
  else
    echo "http://${host}:${FRONTEND_PORT}"
  fi
}

# Writes ~/solvro/docker-compose.yml from the current BIND_ADDR /
# FRONTEND_PORT / BACKEND_PORT / POSTGRES_PORT. Bind address + frontend/
# backend ports stay as literal ${VAR:-default} so docker compose resolves
# them from ~/solvro/.env at `up` time (same mechanism as
# ${POSTGRES_PASSWORD}/${JWT_SECRET}). The postgres `ports:` block can't be
# expressed by interpolation (a key must be present or absent), so it's
# emitted here only when POSTGRES_PORT is set — and it stays bound to
# 127.0.0.1 regardless of BIND_ADDR (never expose the DB on the network
# just because the web app is exposed).
write_compose_file() {
  {
    cat <<'COMPOSE_HEAD'
services:
  postgres:
    image: postgres:15-alpine
    container_name: solvro-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: solvro
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: solvro
    volumes:
      - solvro_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U solvro -d solvro"]
      interval: 5s
      timeout: 5s
      retries: 10
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
COMPOSE_HEAD

    if [[ -n "${POSTGRES_PORT:-}" ]]; then
      printf '    ports:\n      - "127.0.0.1:%s:5432"\n' "$POSTGRES_PORT"
    fi

    cat <<'COMPOSE_REST'

  backend:
    # Pinned to the release the installer wrote into ~/solvro/.env.
    image: ghcr.io/alfi-rajasyah/solvro-cust-backend:${IMAGE_TAG}
    container_name: solvro-backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 3000
      APP_URL: "${APP_URL:-}"
      DATABASE_URL: postgresql://solvro:${POSTGRES_PASSWORD}@postgres:5432/solvro?schema=public
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRES_IN: 8h
      SECRETS_KEY: ${SECRETS_KEY}
      # The browser app calls the API on its own origin, so only the public
      # Solvro address needs to be allowed; "*" when APP_URL is unknown.
      CORS_ORIGIN: "${APP_URL:-*}"
      LOG_LEVEL: info
      # The bundled nginx (compose network, a unique-local address) and a TLS
      # front or tunnel on this host (loopback) are the proxies whose
      # X-Forwarded-For the API believes; a direct client cannot forge it.
      TRUST_PROXY: "${TRUST_PROXY:-loopback, uniquelocal}"
      # "true" accepts a personal iTop token Solvro cannot confirm as the
      # user's own (docs/CONFIGURATION.md); set it in ~/solvro/.env.
      ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS: "${ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS:-false}"
    ports:
      # Local only, whatever BIND_ADDR is: the website's nginx proxies /api/
      # inside the compose network, and a directly reachable API would bypass
      # nginx's headers and rate-limit addressing.
      - "127.0.0.1:${BACKEND_PORT:-3000}:3000"
    command: >
      sh -c "npx prisma migrate deploy && npx prisma db seed && node dist/index.js"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      # First boot runs migrations and the seed before the API listens.
      start_period: 120s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    mem_limit: 768m

  frontend:
    image: ghcr.io/alfi-rajasyah/solvro-cust-frontend:${IMAGE_TAG}
    container_name: solvro-frontend
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
    environment:
      # Outline origin(s) allowed to frame /embed/* and /share/*; empty = off.
      EMBED_FRAME_ANCESTORS: "${EMBED_FRAME_ANCESTORS:-}"
    ports:
      - "${BIND_ADDR:-127.0.0.1}:${FRONTEND_PORT:-80}:80"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    mem_limit: 128m

volumes:
  solvro_pgdata:
    name: solvro_pgdata
COMPOSE_REST
  } > "$COMPOSE_FILE"
}

# Writes the `solvro` command to ~/solvro/bin/solvro and links it onto PATH
# (/usr/local/bin when writable, else ~/.local/bin). Rewritten on every
# install and update, so each release ships its own CLI. `solvro update`
# moves the server to the newest tagged release: the backend image carries
# that release's setup.sh (/opt/solvro/setup.sh), which the CLI runs, so
# compose and .env changes are applied the same way as a manual upgrade.
# Design: docs/archive/plans/solvro-update-cli.md.
install_cli() {
  local bin_dir="$DEPLOY_DIR/bin" link_dir
  mkdir -p "$bin_dir"
  # Written to a temp file and renamed over the old one: a `solvro update`
  # that is running this installer keeps reading the old file (bash reads a
  # script as it goes), so rewriting it in place would corrupt that run.
  local new_cli
  new_cli="$(mktemp "$bin_dir/.solvro.XXXXXX")"
  # The validators, .env helpers and compose writer are this script's own
  # functions, copied in so `solvro config` checks and applies a setting
  # exactly as the installer does.
  local helpers
  helpers="$(declare -f is_port is_ipv4 is_trust_proxy normalise_origin \
    normalise_frame_origins env_file_get env_file_set write_compose_file)"
  {
    cat <<'SOLVRO_CLI_HEAD'
#!/usr/bin/env bash
# Solvro server command — written by setup.sh, do not edit (it is rewritten
# on every update).
set -euo pipefail

DEPLOY_DIR="$HOME/solvro"
ENV_FILE="$DEPLOY_DIR/.env"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
IMAGE_PREFIX="ghcr.io/alfi-rajasyah/solvro-cust"
RELEASES_URL="https://github.com/alfi-rajasyah/solvro-cust/releases/tag"

# ---- shared with setup.sh (copied in when this file is written)
SOLVRO_CLI_HEAD
    printf '%s\n\n' "$helpers"
    cat <<'SOLVRO_CLI'
# ---- solvro commands

usage() {
  cat <<'USAGE'
Usage: solvro <command>

  update [--yes] [--no-backup]  Upgrade to the newest Solvro release. Backs up
                                the database first and asks before changing
                                anything (--yes: don't ask).
  config                        Show the server settings.
  config get KEY                Print one setting.
  config set KEY=VALUE ...      Change settings and restart what they affect,
                                e.g. solvro config set APP_URL=https://solvro.acme.com
  config unset KEY              Remove an optional setting (POSTGRES_PORT,
                                TRUST_PROXY, EMBED_FRAME_ANCESTORS).
  version                       Show the installed release.
  backup                        Write a database dump to ~/solvro/backups/.
  help                          Show this help.

Settings: APP_URL BIND_ADDR FRONTEND_PORT BACKEND_PORT POSTGRES_PORT
          TRUST_PROXY EMBED_FRAME_ANCESTORS
USAGE
}

die() { echo "ERROR: $*" >&2; exit 1; }

require_install() {
  [[ -f "$ENV_FILE" ]] || die "no Solvro install found ($ENV_FILE is missing)."
  cd "$DEPLOY_DIR"
}

installed_tag() {
  local line
  line="$(grep -E '^IMAGE_TAG=' "$ENV_FILE" | tail -n 1)" || true
  line="${line#*=}"; line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

# Prints the path of a new dump of the database in ~/solvro/backups/.
backup() {
  local dir="$DEPLOY_DIR/backups" file
  mkdir -p "$dir"
  chmod 700 "$dir"
  file="$dir/solvro-$(installed_tag)-$(date +%Y%m%d-%H%M%S).dump"
  ( umask 077; docker compose exec -T postgres pg_dump -U solvro -Fc solvro > "$file" ) \
    || { rm -f "$file"; die "database backup failed (is the stack running? try: docker compose ps)."; }
  [[ -s "$file" ]] || { rm -f "$file"; die "database backup is empty."; }
  printf '%s' "$file"
}

# 0 when version $1 is strictly newer than $2 (vX.Y.Z).
is_newer() {
  [[ "$1" != "$2" ]] && [[ "$(printf '%s\n%s\n' "${1#v}" "${2#v}" | sort -V | tail -n 1)" == "${1#v}" ]]
}

cmd_update() {
  local assume_yes=0 do_backup=1 arg
  for arg in "$@"; do
    case "$arg" in
      --yes|-y) assume_yes=1 ;;
      --no-backup) do_backup=0 ;;
      *) die "unknown option '$arg' (see: solvro help)." ;;
    esac
  done
  require_install

  local current latest dump=""
  current="$(installed_tag)"
  [[ -n "$current" ]] || die "IMAGE_TAG is not set in $ENV_FILE."

  echo "Checking for a new release..."
  docker pull -q "$IMAGE_PREFIX-backend:stable" >/dev/null \
    || die "could not pull $IMAGE_PREFIX-backend:stable (is this server logged in? docker login ghcr.io)."
  # Read the version and, later, the installer from this exact image, even if
  # `stable` moves meanwhile.
  local stable_id
  stable_id="$(docker image inspect -f '{{.Id}}' "$IMAGE_PREFIX-backend:stable")"
  latest="v$(docker run --rm --entrypoint node "$stable_id" -p "require('/app/package.json').version")"
  [[ "$latest" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the stable image reports an unexpected version ('$latest')."

  if [[ "$latest" == "$current" ]]; then
    # .env can name a release the stack never started (an earlier upgrade
    # that failed after saving it).
    local running
    running="$(docker compose ps --format '{{.Image}}' backend 2>/dev/null || true)"
    if [[ "$running" != *":$current" ]]; then
      die "$current is installed but the backend is not running it (${running:-not running}). Start it with: cd $DEPLOY_DIR && docker compose up -d"
    fi
    echo "Solvro is up to date ($current)."
    exit 0
  fi
  is_newer "$latest" "$current" \
    || die "the stable release ($latest) is older than the installed one ($current); nothing changed."

  echo
  echo "Solvro $current -> $latest"
  echo "Release notes (read 'Action required' first): $RELEASES_URL/$latest"
  if [[ $do_backup -eq 1 ]]; then
    echo "The database is backed up to $DEPLOY_DIR/backups/ first."
  fi
  if [[ $assume_yes -eq 0 ]]; then
    local answer=""
    { : </dev/tty; } 2>/dev/null || die "no terminal to ask on; re-run with --yes to upgrade without asking."
    read -r -p "Upgrade now? [y/N] " answer </dev/tty || true
    [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]] || { echo "Cancelled; nothing changed."; exit 0; }
  fi

  # Both images must exist before anything changes (a release can still be
  # publishing for a few minutes after its tag).
  docker pull -q "$IMAGE_PREFIX-frontend:$latest" >/dev/null \
    || die "$latest is not fully published yet; try again in a few minutes. Nothing changed."

  if [[ $do_backup -eq 1 ]]; then
    echo "Backing up the database..."
    dump="$(backup)"
    echo "Backup: $dump"
  fi

  # The release's own installer, as shipped in its backend image.
  INSTALLER="$(mktemp)"
  trap 'rm -f "$INSTALLER"' EXIT
  docker run --rm --entrypoint cat "$stable_id" /opt/solvro/setup.sh > "$INSTALLER" \
    || die "the $latest image does not carry the installer; upgrade manually (INSTALL.md, Upgrade)."
  grep -qxF "SOLVRO_IMAGE_TAG=\"$latest\"" "$INSTALLER" \
    || die "the installer in the stable image is not for $latest; the stack was not changed."

  bash "$INSTALLER" \
    || die "the $latest installer failed (see above). Database backup from before: ${dump:-none}. INSTALL.md, Upgrade, has the manual steps."
  echo
  echo "Updated Solvro $current -> $latest."
  if [[ -n "$dump" ]]; then
    echo "Database backup from before the upgrade: $dump"
  fi
}

# Settings `solvro config` may change. Secrets (POSTGRES_PASSWORD, JWT_SECRET,
# SECRETS_KEY) and IMAGE_TAG are never shown or set here.
CONFIG_KEYS=(APP_URL BIND_ADDR FRONTEND_PORT BACKEND_PORT POSTGRES_PORT TRUST_PROXY EMBED_FRAME_ANCESTORS)
CONFIG_OPTIONAL=(POSTGRES_PORT TRUST_PROXY EMBED_FRAME_ANCESTORS)

config_default() {
  case "$1" in
    BIND_ADDR) echo "127.0.0.1" ;;
    FRONTEND_PORT) echo "80" ;;
    BACKEND_PORT) echo "3000" ;;
    TRUST_PROXY) echo "loopback, uniquelocal" ;;
    *) echo "" ;;
  esac
}

config_key() { # dies unless $1 is a setting `solvro config` handles
  local k
  for k in "${CONFIG_KEYS[@]}"; do [[ "$k" == "$1" ]] && return 0; done
  case "$1" in
    POSTGRES_PASSWORD|JWT_SECRET|SECRETS_KEY) die "$1 is a secret and cannot be changed here (see OPERATIONS.md)." ;;
    IMAGE_TAG) die "IMAGE_TAG is set by 'solvro update'." ;;
  esac
  die "unknown setting '$1'. Settings: ${CONFIG_KEYS[*]}"
}

# Prints the value $2 for setting $1 in its saved form, or dies.
config_value() {
  local key="$1" value="$2" out
  [[ "$value" != *[[:cntrl:]]* ]] || die "$key must be on one line (no tabs or line breaks)."
  case "$key" in
    APP_URL)
      out="$(normalise_origin "$value")" || die "APP_URL must be a bare http(s) address such as https://solvro.example.com (no path, query or login)." ;;
    BIND_ADDR)
      is_ipv4 "$value" || die "BIND_ADDR must be an IPv4 address such as 127.0.0.1 or 0.0.0.0."
      out="$value" ;;
    FRONTEND_PORT|BACKEND_PORT|POSTGRES_PORT)
      is_port "$value" || die "$key must be a port number 1-65535."
      out="$((10#$value))" ;;
    TRUST_PROXY)
      is_trust_proxy "$value" || die "TRUST_PROXY must be a hop count 0-10 or a comma list of loopback, linklocal, uniquelocal, IPs or CIDRs."
      out="$value" ;;
    EMBED_FRAME_ANCESTORS)
      out="$(normalise_frame_origins "$value")" && [[ -n "$out" ]] \
        || die "EMBED_FRAME_ANCESTORS must be a space-separated list of http(s) addresses such as https://docs.example.com." ;;
  esac
  printf '%s' "$out"
}

config_effective() { # saved value, else the default
  local v
  v="$(env_file_get "$1")"
  printf '%s' "${v:-$(config_default "$1")}"
}

# Copies .env and the compose file aside before a change (mode 600: .env
# holds the secrets), so a change compose cannot start is undone.
config_snapshot() {
  SNAP_DIR="$(mktemp -d "$DEPLOY_DIR/.config-before.XXXXXX")"
  trap 'rm -rf "$SNAP_DIR"' EXIT
  cp -p "$ENV_FILE" "$SNAP_DIR/env"
  [[ -f "$COMPOSE_FILE" ]] && cp -p "$COMPOSE_FILE" "$SNAP_DIR/compose"
  return 0
}

# Regenerates the compose file (a published Postgres port is part of it) and
# lets compose restart only the services whose settings changed. If that
# fails (e.g. the new port is taken), the previous files come back and the
# stack is started on them again.
config_apply() {
  POSTGRES_PORT="$(env_file_get POSTGRES_PORT)"
  write_compose_file
  echo "Applying..."
  if ! docker compose up -d; then
    cp -p "$SNAP_DIR/env" "$ENV_FILE"
    if [[ -f "$SNAP_DIR/compose" ]]; then
      cp -p "$SNAP_DIR/compose" "$COMPOSE_FILE"
    else
      rm -f "$COMPOSE_FILE"
    fi
    echo "Restoring the previous settings..." >&2
    docker compose up -d || true
    die "the change could not be applied (see the error above); the previous settings were restored."
  fi
}

config_env_unset() {
  local tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  grep -v "^${1}=" "$ENV_FILE" > "$tmp" || true
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

cmd_config() {
  require_install
  local action="${1:-show}" key value pair
  case "$action" in
    show)
      echo "Solvro $(installed_tag) settings ($ENV_FILE):"
      for key in "${CONFIG_KEYS[@]}"; do
        value="$(env_file_get "$key")"
        if [[ -n "$value" ]]; then
          printf '  %-22s %s\n' "$key" "$value"
        elif [[ -n "$(config_default "$key")" ]]; then
          printf '  %-22s %s (default)\n' "$key" "$(config_default "$key")"
        else
          printf '  %-22s (not set)\n' "$key"
        fi
      done
      echo "Change one with: solvro config set KEY=VALUE"
      ;;
    get)
      [[ $# -eq 2 ]] || die "usage: solvro config get KEY"
      config_key "$2"
      config_effective "$2"; echo
      ;;
    set)
      shift
      [[ $# -ge 1 ]] || die "usage: solvro config set KEY=VALUE [KEY=VALUE ...]"
      # Validate everything first; nothing is written unless all values pass.
      local -A new=()
      for pair in "$@"; do
        [[ "$pair" == *=* ]] || die "'$pair' is not KEY=VALUE."
        key="${pair%%=*}"; value="${pair#*=}"
        config_key "$key"
        [[ -n "$value" ]] || die "$key needs a value (to remove an optional setting: solvro config unset $key)."
        new[$key]="$(config_value "$key" "$value")"
      done
      local fp bp pp
      fp="${new[FRONTEND_PORT]:-$(config_effective FRONTEND_PORT)}"
      bp="${new[BACKEND_PORT]:-$(config_effective BACKEND_PORT)}"
      pp="${new[POSTGRES_PORT]:-$(config_effective POSTGRES_PORT)}"
      [[ "$fp" != "$bp" ]] || die "FRONTEND_PORT and BACKEND_PORT must differ (both $fp)."
      if [[ -n "$pp" && ( "$pp" == "$fp" || "$pp" == "$bp" ) ]]; then
        die "POSTGRES_PORT must differ from the website and API ports."
      fi
      config_snapshot
      for key in "${!new[@]}"; do
        env_file_set "$key" "${new[$key]}"
        echo "  $key = ${new[$key]}"
      done
      config_apply
      if [[ -n "${new[BIND_ADDR]:-}" && "${new[BIND_ADDR]}" != "127.0.0.1" ]]; then
        echo "NOTE: the website now listens on ${new[BIND_ADDR]}. Only the in-app login protects it;"
        echo "      keep it behind a trusted network or put TLS in front (OPERATIONS.md section 11)."
      fi
      if [[ -z "${new[APP_URL]:-}" && ( -n "${new[FRONTEND_PORT]:-}" || -n "${new[BIND_ADDR]:-}" ) ]]; then
        echo "NOTE: APP_URL is still $(config_effective APP_URL). If people now open Solvro at another"
        echo "      address, set it too: solvro config set APP_URL=..."
      fi
      echo "Saved."
      ;;
    unset)
      [[ $# -eq 2 ]] || die "usage: solvro config unset KEY"
      config_key "$2"
      local ok=0
      for key in "${CONFIG_OPTIONAL[@]}"; do [[ "$key" == "$2" ]] && ok=1; done
      [[ $ok -eq 1 ]] || die "$2 cannot be removed; change it with: solvro config set $2=VALUE"
      config_snapshot
      config_env_unset "$2"
      echo "  $2 removed"
      config_apply
      echo "Saved."
      ;;
    *) die "unknown config action '$action' (show, get, set, unset)." ;;
  esac
}

main() {
  local file
  case "${1:-help}" in
    update)  shift; cmd_update "$@" ;;
    config)  shift; cmd_config "$@" ;;
    version) require_install; echo "Solvro $(installed_tag)" ;;
    backup)  require_install; file="$(backup)"; echo "Backup: $file" ;;
    help|-h|--help) usage ;;
    *) usage >&2; exit 1 ;;
  esac
}

# One line, so bash has read the whole command before main runs.
main "$@"; exit $?
SOLVRO_CLI
  } > "$new_cli"
  chmod 755 "$new_cli"
  mv -f "$new_cli" "$bin_dir/solvro"

  if [[ -w /usr/local/bin ]]; then
    link_dir=/usr/local/bin
  else
    link_dir="$HOME/.local/bin"
    mkdir -p "$link_dir"
  fi
  ln -sfn "$bin_dir/solvro" "$link_dir/solvro"
  if [[ "$(command -v solvro 2>/dev/null)" != "$link_dir/solvro" ]]; then
    echo "NOTE: installed the 'solvro' command in $link_dir, which is not on PATH in this shell."
    echo "      Sign in again (Ubuntu adds ~/.local/bin at login) or run $bin_dir/solvro."
  fi
}

# Values passed in the environment, captured before ~/solvro/.env can overwrite
# them: on a re-run they update the saved setting.
REQ_APP_URL="${APP_URL:-}"
REQ_EMBED="${EMBED_FRAME_ANCESTORS:-}"

# ------------------------------------------------------------------ branch: update vs fresh install
if [[ -f "$ENV_FILE" ]]; then
  echo "Existing install detected (~/solvro/.env present). Pulling new images and restarting..."
  # Reuse the ports persisted at first install. Older installs predate the
  # port vars — the compose ${VAR:-default} fallbacks keep them on 80/3000
  # and Postgres unpublished, exactly as before (now bound to 127.0.0.1).
  set -a
  # APP_URL and EMBED_FRAME_ANCESTORS are read separately below: they may hold
  # spaces and be unquoted in a hand-edited file, which sourcing would run.
  # shellcheck disable=SC1090
  . <(grep -vE '^(APP_URL|EMBED_FRAME_ANCESTORS)=' "$ENV_FILE")
  set +a
  # Older installs predate SECRETS_KEY (secrets-at-rest for integration
  # tokens) — generate it once and append, never overwriting an existing value.
  if [[ -z "${SECRETS_KEY:-}" ]]; then
    SECRETS_KEY=$(openssl rand -base64 32)
    echo "SECRETS_KEY=$SECRETS_KEY" >> "$ENV_FILE"
  fi
  # The upgrade itself: this script's release becomes the pinned image tag.
  # Saved to .env only once its images are pulled (below), so a failed pull
  # leaves the server pinned to the release it runs.
  IMAGE_TAG="$SOLVRO_IMAGE_TAG"
  export IMAGE_TAG
  # Outline embedding allow-list: a value passed in the environment replaces the
  # saved one; either way it is validated and re-saved quoted.
  EMBED_FRAME_ANCESTORS="${REQ_EMBED:-$(env_file_get EMBED_FRAME_ANCESTORS)}"
  if [[ -n "$EMBED_FRAME_ANCESTORS" ]]; then
    if NORMALISED="$(normalise_frame_origins "$EMBED_FRAME_ANCESTORS")"; then
      EMBED_FRAME_ANCESTORS="$NORMALISED"
      [[ -n "$EMBED_FRAME_ANCESTORS" ]] && env_file_set EMBED_FRAME_ANCESTORS "$EMBED_FRAME_ANCESTORS"
    elif [[ -n "$REQ_EMBED" ]]; then
      echo "ERROR: EMBED_FRAME_ANCESTORS must be a space-separated list of http(s) origins such as https://docs.example.com (got '$REQ_EMBED')."
      exit 1
    else
      echo "WARNING: EMBED_FRAME_ANCESTORS in $ENV_FILE is not a list of http(s) origins; the website will refuse all embedding until it is fixed."
    fi
  fi
  export EMBED_FRAME_ANCESTORS

  # Public Solvro address. Older installs predate it: try to save the default
  # derived from the bind address + website port and say so. If that guess is
  # not a valid origin, APP_URL stays unset — the backend then starts with the
  # Outline integration disabled (and says so in its boot log).
  APP_URL="${REQ_APP_URL:-$(env_file_get APP_URL)}"
  if [[ -n "$APP_URL" ]]; then
    if NORMALISED="$(normalise_origin "$APP_URL")"; then
      APP_URL="$NORMALISED"
      env_file_set APP_URL "$APP_URL"
    elif [[ -n "$REQ_APP_URL" ]]; then
      echo "ERROR: APP_URL must be a bare http(s) address such as https://solvro.example.com — no path, query or login (got '$REQ_APP_URL')."
      exit 1
    else
      echo "WARNING: APP_URL in $ENV_FILE is not a bare http(s) address; the Outline integration stays disabled until it is fixed."
    fi
  elif DERIVED_APP_URL="$(normalise_origin "$(app_url)")"; then
    APP_URL="$DERIVED_APP_URL"
    env_file_set APP_URL "$APP_URL"
    echo "NOTE: APP_URL was not set; saved $APP_URL. If users reach Solvro on another address, re-run with APP_URL=https://... or edit $ENV_FILE."
  else
    APP_URL=""
    echo "NOTE: APP_URL is not set and no address could be derived from this server; the Outline integration stays disabled. Re-run with APP_URL=https://... or edit $ENV_FILE."
  fi
  export APP_URL

  write_compose_file
  docker compose pull
  env_file_set IMAGE_TAG "$IMAGE_TAG"
  docker compose up -d
  install_cli
  echo
  echo "Solvro updated to $IMAGE_TAG. Open $(app_url)"
  echo "Next time, upgrade with: solvro update"
  exit 0
fi

# ------------------------------------------------------------------ fresh install

# Guard BEFORE anything is prompted or written: a fresh install deletes the
# solvro_pgdata volume further down so the new POSTGRES_PASSWORD matches an
# empty database. Without ~/solvro/.env this script cannot tell a new server
# from one whose env file was lost — or from a run as a different Unix user
# ($HOME differs per user; the Docker volume is global to the host). If the
# volume already exists, stop here, before a new .env or compose file is
# written, unless the operator explicitly asks for the wipe with FORCE_FRESH=1.
# The guard needs a working daemon: an `inspect` that fails for another
# reason (daemon down, socket permission) must not read as "no volume".
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: cannot talk to the Docker daemon. Is it running, and is $(id -un) allowed to use it (docker group)?"
  exit 1
fi
if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  if [[ "${FORCE_FRESH:-}" != "1" ]]; then
    cat <<MSG
ERROR: the Docker volume '$VOLUME_NAME' already exists, but $ENV_FILE does not.

This looks like an existing Solvro install whose .env file is missing, or this
script is running as a different user than the one who installed it. A fresh
install would DELETE that volume and every record in it. Nothing was changed.

  - To keep the data:  restore $ENV_FILE from your backup, then re-run.
  - To start over with an empty database:  FORCE_FRESH=1 bash setup.sh

See OPERATIONS.md, section 9.
MSG
    exit 1
  fi
  echo "FORCE_FRESH=1 is set: the existing volume '$VOLUME_NAME' will be deleted."
fi

if [[ $ADVANCED -eq 1 ]]; then
  echo "Fresh install (advanced). You'll be asked for the admin account, host ports and network settings."
else
  echo "Fresh install. You'll be asked for the admin account and the address people will open Solvro at."
  echo "(Ports and bind address follow from that address; run with --advanced to choose them yourself.)"
fi
echo

# Inputs come from env vars (for automation) or from prompts read from
# /dev/tty, which also works when the script itself arrives on stdin:
#
#   ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=secret APP_URL=https://solvro.x.com bash setup.sh

ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
  if ! have_tty; then
    echo "ERROR: no /dev/tty available and ADMIN_EMAIL/ADMIN_PASSWORD not set."
    echo "Re-run with env vars:"
    echo "  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret bash setup.sh"
    exit 1
  fi

  if [[ -z "$ADMIN_EMAIL" ]]; then
    read -r -p "Admin email: " ADMIN_EMAIL </dev/tty
  fi

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    read -r -s -p "Admin password (min 8 chars): " ADMIN_PASSWORD </dev/tty
    echo
    read -r -s -p "Confirm password: " ADMIN_PASSWORD_CONFIRM </dev/tty
    echo
    [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD_CONFIRM" ]] || {
      echo "ERROR: passwords do not match."
      exit 1
    }
  fi
fi

[[ -n "$ADMIN_EMAIL" && "$ADMIN_EMAIL" == *"@"* ]] || {
  echo "ERROR: invalid email."
  exit 1
}
[[ ${#ADMIN_PASSWORD} -ge 8 ]] || {
  echo "ERROR: password must be at least 8 characters."
  exit 1
}

# Ports: env var, else interactive prompt with the default pre-filled
# (Enter accepts it). No /dev/tty → silently take the defaults so
# non-interactive automation keeps working.
FRONTEND_PORT="${FRONTEND_PORT:-}"
BACKEND_PORT="${BACKEND_PORT:-}"
POSTGRES_PORT="${POSTGRES_PORT:-}"
BIND_ADDR="${BIND_ADDR:-}"
TRUST_PROXY="${TRUST_PROXY:-}"
EMBED_FRAME_ANCESTORS="$REQ_EMBED"
APP_URL="$REQ_APP_URL"

BEHIND_TLS=0
if [[ $ADVANCED -eq 1 ]]; then
  if have_tty; then
    [[ -z "$FRONTEND_PORT" ]] && \
      read -r -p "Website port [80]: " FRONTEND_PORT </dev/tty
    [[ -z "$BACKEND_PORT" ]] && \
      read -r -p "API port [3000]: " BACKEND_PORT </dev/tty
    [[ -z "$POSTGRES_PORT" ]] && \
      read -r -p "Postgres host port (blank = keep private) []: " POSTGRES_PORT </dev/tty
    [[ -z "$BIND_ADDR" ]] && \
      read -r -p "Bind address [127.0.0.1] (0.0.0.0 = all interfaces): " BIND_ADDR </dev/tty
    [[ -z "$EMBED_FRAME_ANCESTORS" ]] && \
      read -r -p "Outline address allowed to embed Solvro, e.g. https://docs.example.com (blank = no embedding) []: " EMBED_FRAME_ANCESTORS </dev/tty
  fi
elif [[ -z "$APP_URL" && ( -n "$BIND_ADDR" || -n "$FRONTEND_PORT" ) ]]; then
  # Scripted install that names the bind address or port but not the address:
  # keep the previous behaviour, where the address is derived from them below.
  :
else
  # Quick install: one question, the address people open, and the network
  # settings follow from it (a setting given as an env var always wins):
  #   https://...             a TLS proxy or tunnel on this host forwards to
  #                           Solvro, which listens on 127.0.0.1:8090 (80 is
  #                           left free for the proxy)
  #   http://localhost        this server only, port 80 (the old default)
  #   http://<host>[:port]    reachable on the network (0.0.0.0), that port
  if [[ -z "$APP_URL" ]] && have_tty; then
    read -r -p "Address people will open Solvro at, e.g. https://solvro.example.com [http://localhost]: " APP_URL </dev/tty
  fi
  APP_URL="${APP_URL:-http://localhost}"
  APP_URL="$(normalise_origin "$APP_URL")" || {
    echo "ERROR: the address must be a bare http(s) address such as https://solvro.example.com — no path, query or login."
    exit 1
  }
  url_rest="${APP_URL#*://}"
  url_host="${url_rest%%:*}"
  url_host="${url_host,,}"
  url_port=""
  [[ "$url_rest" == *:* ]] && url_port="${url_rest##*:}"
  if [[ "$APP_URL" == https://* ]]; then
    BEHIND_TLS=1
    : "${BIND_ADDR:=127.0.0.1}"
    : "${FRONTEND_PORT:=8090}"
  else
    if [[ "$url_host" == "localhost" || "$url_host" == 127.* ]]; then
      : "${BIND_ADDR:=127.0.0.1}"
    else
      : "${BIND_ADDR:=0.0.0.0}"
    fi
    : "${FRONTEND_PORT:=${url_port:-80}}"
    # An address on :3000 takes the API's default port; the API only listens
    # on 127.0.0.1, so it moves aside rather than failing the install.
    [[ "$FRONTEND_PORT" == "3000" && -z "$BACKEND_PORT" ]] && BACKEND_PORT=3001
  fi
fi

FRONTEND_PORT="${FRONTEND_PORT:-80}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
# POSTGRES_PORT intentionally left empty when not provided → DB stays private.

is_port "$FRONTEND_PORT" || {
  echo "ERROR: FRONTEND_PORT must be an integer 1-65535 (got '$FRONTEND_PORT')."
  exit 1
}
is_port "$BACKEND_PORT" || {
  echo "ERROR: BACKEND_PORT must be an integer 1-65535 (got '$BACKEND_PORT')."
  exit 1
}
if [[ "$FRONTEND_PORT" == "$BACKEND_PORT" ]]; then
  echo "ERROR: FRONTEND_PORT and BACKEND_PORT must differ (both '$FRONTEND_PORT')."
  exit 1
fi
if [[ -n "$POSTGRES_PORT" ]]; then
  is_port "$POSTGRES_PORT" || {
    echo "ERROR: POSTGRES_PORT must be an integer 1-65535 or blank (got '$POSTGRES_PORT')."
    exit 1
  }
  if [[ "$POSTGRES_PORT" == "$FRONTEND_PORT" || "$POSTGRES_PORT" == "$BACKEND_PORT" ]]; then
    echo "ERROR: POSTGRES_PORT must differ from the website/API ports."
    exit 1
  fi
fi
is_ipv4 "$BIND_ADDR" || {
  echo "ERROR: BIND_ADDR must be an IPv4 address (e.g. 127.0.0.1, 0.0.0.0, 192.168.1.10) — got '$BIND_ADDR'."
  exit 1
}
if [[ -n "$TRUST_PROXY" ]]; then
  is_trust_proxy "$TRUST_PROXY" || {
    echo "ERROR: TRUST_PROXY must be a hop count 0-10 or a comma list of loopback, linklocal, uniquelocal, IP addresses or CIDRs (got '$TRUST_PROXY')."
    exit 1
  }
fi

# Public address: the prompt default is derived from the bind address + website
# port; no tty → the default is taken silently.
if [[ -z "$APP_URL" ]] && have_tty; then
  read -r -p "Public Solvro address [$(normalise_origin "$(app_url)" || echo "none")]: " APP_URL </dev/tty
fi
if [[ -n "$APP_URL" ]]; then
  APP_URL="$(normalise_origin "$APP_URL")" || {
    echo "ERROR: APP_URL must be a bare http(s) address such as https://solvro.example.com — no path, query or login."
    exit 1
  }
elif APP_URL="$(normalise_origin "$(app_url)")"; then
  :
else
  # e.g. 0.0.0.0 on a host with no discoverable IP: leave it unset rather than
  # save a placeholder — the Outline integration stays disabled until it is set.
  APP_URL=""
  echo "NOTE: could not derive a public address; APP_URL is left unset (Outline integration disabled). Set it in $ENV_FILE later."
fi
if [[ -n "$EMBED_FRAME_ANCESTORS" ]]; then
  EMBED_FRAME_ANCESTORS="$(normalise_frame_origins "$EMBED_FRAME_ANCESTORS")" || {
    echo "ERROR: EMBED_FRAME_ANCESTORS must be a space-separated list of http(s) origins such as https://docs.example.com — no paths, wildcards or other characters."
    exit 1
  }
fi

# hex (not base64): base64's `/` `+` `=` are unsafe in the DATABASE_URL
# userinfo and truncate it (P1013 "invalid port number"). 24 bytes = 192 bits.
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
# Base64 (not hex): SECRETS_KEY must decode to exactly 32 bytes for AES-256-GCM (backend/src/env.ts).
SECRETS_KEY=$(openssl rand -base64 32)

IMAGE_TAG="$SOLVRO_IMAGE_TAG"
cat > "$ENV_FILE" <<EOF
IMAGE_TAG=$IMAGE_TAG
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
SECRETS_KEY=$SECRETS_KEY
BIND_ADDR=$BIND_ADDR
FRONTEND_PORT=$FRONTEND_PORT
BACKEND_PORT=$BACKEND_PORT
EOF
[[ -n "$APP_URL" ]] && echo "APP_URL=\"$APP_URL\"" >> "$ENV_FILE"
[[ -n "$POSTGRES_PORT" ]] && echo "POSTGRES_PORT=$POSTGRES_PORT" >> "$ENV_FILE"
# Quoted: the value may hold spaces ("loopback, uniquelocal") and .env is sourced by bash on update.
[[ -n "$TRUST_PROXY" ]] && echo "TRUST_PROXY=\"$TRUST_PROXY\"" >> "$ENV_FILE"
# Quoted for the same reason (a list of origins is space-separated).
[[ -n "$EMBED_FRAME_ANCESTORS" ]] && echo "EMBED_FRAME_ANCESTORS=\"$EMBED_FRAME_ANCESTORS\"" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

write_compose_file

# Wipe any prior bad postgres state so the new password takes effect. Safe
# here only because the guard at the top of this branch already refused an
# existing volume unless FORCE_FRESH=1 was given.
echo
echo "Clearing any prior stack and database volume..."
docker compose down 2>/dev/null || true
docker volume rm "$VOLUME_NAME" 2>/dev/null || true

echo "Pulling images..."
docker compose pull

echo "Starting stack..."
docker compose up -d

# The API is published on 127.0.0.1 only (see the compose file), whatever
# BIND_ADDR the website uses.
HEALTH_HOST="127.0.0.1"

# Wait for backend to be ready (max ~120s — first boot includes migrate + seed)
echo -n "Waiting for backend to come up"
for _ in $(seq 1 60); do
  if curl -sf "http://${HEALTH_HOST}:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo " ready."
    break
  fi
  echo -n "."
  sleep 2
done

if ! curl -sf "http://${HEALTH_HOST}:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  echo
  echo "ERROR: backend did not come up within ~2 minutes. Recent logs:"
  docker compose logs backend --tail 40
  exit 1
fi

# Create the admin user
echo "Creating admin user..."
docker compose exec -T \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  backend npx tsx scripts/create-admin.ts

install_cli

LOCAL_URL="$(app_url)"

echo
echo "============================================================"
if [[ "$BIND_ADDR" == "127.0.0.1" ]]; then
  echo " Solvro is running (local-only — bound to 127.0.0.1)."
else
  echo " Solvro is running (bound to $BIND_ADDR — reachable on the network)."
fi
echo
echo "   URL:       $LOCAL_URL"
echo "   Public:    ${APP_URL:-not set}  (APP_URL — Outline OAuth/webhook URLs are built from it)"
echo "   Login as:  $ADMIN_EMAIL"
echo
echo "   Ports:     website $FRONTEND_PORT · API $BACKEND_PORT (127.0.0.1 only) · Postgres ${POSTGRES_PORT:-not published}"
echo "   Bind:      $BIND_ADDR"
echo "   Embedding: ${EMBED_FRAME_ANCESTORS:-off (pages cannot be framed)}"
echo
if [[ $BEHIND_TLS -eq 1 && "$BIND_ADDR" == "127.0.0.1" ]]; then
  echo " Point your TLS proxy or tunnel for $APP_URL at http://127.0.0.1:${FRONTEND_PORT}"
elif [[ "$BIND_ADDR" == "127.0.0.1" ]]; then
  echo " Reachable only from this server. From your machine, tunnel:"
  echo "   ssh -L ${FRONTEND_PORT}:localhost:${FRONTEND_PORT} <user>@<server>"
  echo "   then open $LOCAL_URL"
else
  echo " Reachable on the network at $LOCAL_URL"
  echo " NOTE: only the in-app login protects it — keep it behind a trusted"
  echo "       network / VPN / firewall, and put TLS in front before anyone"
  echo "       signs in over a network you do not control (INSTALL.md, TLS)."
  echo "       (The API and Postgres stay private on 127.0.0.1.)"
fi
echo
echo " Useful commands (run from $DEPLOY_DIR):"
echo "   docker compose ps              # check container status"
echo "   docker compose logs -f backend # tail backend logs"
echo "   solvro update                  # upgrade to the newest release (backs up the database first)"
echo "   solvro config                  # show the settings; change one with e.g."
echo "   solvro config set APP_URL=https://solvro.example.com"
echo "============================================================"
