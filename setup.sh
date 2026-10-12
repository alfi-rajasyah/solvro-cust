#!/usr/bin/env bash
# Solvro one-shot deploy script.
#
# First run on a fresh server:
#   - Prompts for an admin email + password
#   - Prompts for the host ports (website / API / optional Postgres), each
#     with a default you can accept by pressing Enter
#   - Generates random POSTGRES_PASSWORD and JWT_SECRET
#   - Writes ~/solvro/{docker-compose.yml,.env}
#   - Wipes any prior solvro_pgdata volume (clears stale postgres state)
#   - Brings the stack up and creates the admin user
#
# Re-runs on a server that already has ~/solvro/.env:
#   - Detects existing install, skips prompts
#   - Reuses the ports from ~/solvro/.env, pulls new images, restarts
#
# Host binding + ports (set as env vars or answer the prompts):
#   BIND_ADDR       interface   (default 127.0.0.1 = local-only: reach it
#                                from the server or an SSH tunnel only.
#                                0.0.0.0 = all interfaces / on the network;
#                                or a specific LAN IP. Applies to website +
#                                API; Postgres always stays on 127.0.0.1.)
#   FRONTEND_PORT   website     (default 80)
#   BACKEND_PORT    API         (default 3000)
#   POSTGRES_PORT   database    (default: NOT published — stays private)
#   TRUST_PROXY     proxy hops the API trusts for the client IP (default 1 =
#                   the bundled nginx only; 2 when a tunnel or CDN sits in
#                   front of it; or a comma list of loopback/linklocal/
#                   uniquelocal/IPs/CIDRs). Saved to .env when set.
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
COMPOSE_HEAD

    if [[ -n "${POSTGRES_PORT:-}" ]]; then
      printf '    ports:\n      - "127.0.0.1:%s:5432"\n' "$POSTGRES_PORT"
    fi

    cat <<'COMPOSE_REST'

  backend:
    image: ghcr.io/alfi-rajasyah/solvro-cust-backend:latest
    container_name: solvro-backend
    restart: unless-stopped
    pull_policy: always
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
      CORS_ORIGIN: "*"
      LOG_LEVEL: info
      TRUST_PROXY: "${TRUST_PROXY:-1}"
    ports:
      - "${BIND_ADDR:-127.0.0.1}:${BACKEND_PORT:-3000}:3000"
    command: >
      sh -c "npx prisma migrate deploy && npx prisma db seed && node dist/index.js"

  frontend:
    image: ghcr.io/alfi-rajasyah/solvro-cust-frontend:latest
    container_name: solvro-frontend
    restart: unless-stopped
    pull_policy: always
    depends_on:
      - backend
    environment:
      # Outline origin(s) allowed to frame /embed/* and /share/*; empty = off.
      EMBED_FRAME_ANCESTORS: "${EMBED_FRAME_ANCESTORS:-}"
    ports:
      - "${BIND_ADDR:-127.0.0.1}:${FRONTEND_PORT:-80}:80"

volumes:
  solvro_pgdata:
    name: solvro_pgdata
COMPOSE_REST
  } > "$COMPOSE_FILE"
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
  docker compose up -d
  echo
  echo "Solvro updated. Open $(app_url)"
  exit 0
fi

# ------------------------------------------------------------------ fresh install
echo "Fresh install. You'll be asked for the admin account and host ports."
echo

# Inputs can come from env vars (preferred for `curl | bash` and CI/automation)
# or from interactive prompts read from /dev/tty (so prompts work even when
# the script is piped from curl, where stdin is the curl pipe).
#
#   ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=secret BIND_ADDR=0.0.0.0 \
#   FRONTEND_PORT=8090 BACKEND_PORT=3000 bash <(curl -sSL <url>)
# or
#   bash <(curl -sSL <url>)        # then answer prompts
# or
#   curl -sSL <url> -o setup.sh && bash setup.sh

ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
  if [[ ! -r /dev/tty ]]; then
    echo "ERROR: no /dev/tty available and ADMIN_EMAIL/ADMIN_PASSWORD not set."
    echo "Re-run with env vars:"
    echo "  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret bash <(curl -sSL <url>)"
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

if [[ -r /dev/tty ]]; then
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
if [[ -z "$APP_URL" && -r /dev/tty ]]; then
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

cat > "$ENV_FILE" <<EOF
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

# Wipe any prior bad postgres state so the new password takes effect
echo
echo "Clearing any prior stack and database volume..."
docker compose down 2>/dev/null || true
docker volume rm "$VOLUME_NAME" 2>/dev/null || true

echo "Pulling images..."
docker compose pull

echo "Starting stack..."
docker compose up -d

# Probe host for the readiness check. 0.0.0.0 binds include loopback and
# 127.0.0.1 obviously does, so use 127.0.0.1 for both; a specific bind IP
# does NOT bind loopback, so hit that IP directly.
HEALTH_HOST="$BIND_ADDR"
[[ "$BIND_ADDR" == "0.0.0.0" ]] && HEALTH_HOST="127.0.0.1"

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
echo "   Ports:     website $FRONTEND_PORT · API $BACKEND_PORT · Postgres ${POSTGRES_PORT:-not published}"
echo "   Bind:      $BIND_ADDR"
echo "   Embedding: ${EMBED_FRAME_ANCESTORS:-off (pages cannot be framed)}"
echo
if [[ "$BIND_ADDR" == "127.0.0.1" ]]; then
  echo " Reachable only from this server. From your machine, tunnel:"
  echo "   ssh -L ${FRONTEND_PORT}:localhost:${FRONTEND_PORT} <user>@<server>"
  echo "   then open $LOCAL_URL"
else
  echo " Reachable on the network at $LOCAL_URL"
  echo " NOTE: only the in-app login protects it — keep it behind a trusted"
  echo "       network / VPN / firewall. (Postgres stays private on 127.0.0.1.)"
fi
echo
echo " Useful commands (run from $DEPLOY_DIR):"
echo "   docker compose ps              # check container status"
echo "   docker compose logs -f backend # tail backend logs"
echo "   bash setup.sh                  # re-run to update images"
echo "   # change bind address / ports / EMBED_FRAME_ANCESTORS later: edit ~/solvro/.env then"
echo "   docker compose up -d"
echo
echo " To enable Google sign-in:"
echo "   1. Create an OAuth 2.0 Client ID in Google Cloud Console"
echo "      (Web application, add ${APP_URL:-$LOCAL_URL} as an Authorized JS origin —"
echo "      use the exact host:port you reach Solvro on)."
echo "   2. Sign in as admin → Admin → Sign-in tab → paste the Client ID,"
echo "      add at least one allowed email domain, click Save."
echo "      No restart, no rebuild needed."
echo
echo " Backup the database before destructive operations:"
echo "   docker run --rm -v $VOLUME_NAME:/data -v \$PWD:/backup alpine \\"
echo "     tar czf /backup/pg-\$(date +%F).tgz -C / data"
echo "============================================================"
