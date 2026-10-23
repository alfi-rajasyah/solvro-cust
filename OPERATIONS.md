# Solvro — Configuration

Everything an operator needs to know about a Solvro install. The installer is `setup.sh`; this page describes what it puts on the server and what you can change.

## 1. What runs

Three containers on one Docker network, in `~/solvro/docker-compose.yml`:

| Container | Image | Role | Published on |
|---|---|---|---|
| `solvro-frontend` | `ghcr.io/alfi-rajasyah/solvro-cust-frontend` | nginx: serves the web app and forwards `/api/*` to the backend | `BIND_ADDR:FRONTEND_PORT` (default `127.0.0.1:80`) |
| `solvro-backend` | `ghcr.io/alfi-rajasyah/solvro-cust-backend` | The API (Node.js) | `BIND_ADDR:BACKEND_PORT` (default `127.0.0.1:3000`) |
| `solvro-postgres` | `postgres:15-alpine` | The database | Not published, unless `POSTGRES_PORT` is set. Then `127.0.0.1:POSTGRES_PORT`, never the network. |

The browser talks to the website port only. The website forwards `/api/*` to the backend inside the Docker network. The API port is published for tools and scripts that call the API directly; you can leave it firewalled.

Data lives in one Docker volume, `solvro_pgdata`.

## 2. Files on the server

| File | Written by | Edit it? |
|---|---|---|
| `~/solvro/.env` | The installer, on first install | Yes. Ports and bind address live here. Secrets too; keep the file at mode `600`. |
| `~/solvro/docker-compose.yml` | The installer, on every run | No. It is regenerated from `.env` each time `setup.sh` runs. |

`~/solvro/.env` holds:

| Variable | Set by | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | generated | Database password. Changing it after install breaks the database login. |
| `JWT_SECRET` | generated | Signs login sessions. Changing it signs everyone out. |
| `SECRETS_KEY` | generated | Encrypts integration tokens at rest (currently the iTop connection token). Changing it invalidates every stored token — they must be re-entered. |
| `BIND_ADDR` | prompt | Interface the website and API bind to. `127.0.0.1` local only, `0.0.0.0` all interfaces, or one LAN IP. |
| `FRONTEND_PORT` | prompt | Website port. Default `80`. |
| `BACKEND_PORT` | prompt | API port. Default `3000`. |
| `POSTGRES_PORT` | prompt, optional | Host port for the database. Absent = not published. |

To apply a change to `BIND_ADDR`, `FRONTEND_PORT`, or `BACKEND_PORT`: edit `.env`, then `docker compose up -d` from `~/solvro`. To apply a change to `POSTGRES_PORT`: edit `.env`, then run `bash setup.sh` again (the compose file must be regenerated).

## 3. Backend environment

The compose file sets these on the backend container. They are not meant to be edited by hand; the installer owns the file.

| Variable | Value | Meaning |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | Container-internal port. |
| `DATABASE_URL` | `postgresql://solvro:…@postgres:5432/solvro` | Built from `POSTGRES_PASSWORD`. |
| `JWT_SECRET` | from `.env` | |
| `SECRETS_KEY` | from `.env` | AES-256-GCM key for secrets at rest (iTop token). |
| `JWT_EXPIRES_IN` | `8h` | Session length. |
| `CORS_ORIGIN` | `APP_URL` (or `*` when unset) | Which other browser origins may call the API. The app itself is same-origin and never needs it. |
| `TRUST_PROXY` | `loopback, uniquelocal` | Which proxies the API believes for the client address: the bundled nginx and a TLS front or tunnel on this host. `.env` can override it. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

Google sign-in is **not** configured by environment variables. See section 6.

## 4. Startup and the database

On every start the backend runs, in order:

1. `prisma migrate deploy` — applies any schema migrations the new version ships. Upgrades need no manual database step.
2. `prisma db seed` — makes sure the four built-in roles (`ADMIN`, `TAM`, `STAKEHOLDER`, `PENDING`) and the sign-in settings row exist. The seed creates no users.
3. The API.

The installer waits up to 2 minutes for `GET /health` on the API port, then creates the admin user.

## 5. Users and the first admin

There are no default credentials. The installer creates the first admin from the email and password you gave it. Every other user is created in the app under Admin → Users, or arrives through Google sign-in.

To reset the admin password, run from `~/solvro` (re-running with the same email resets that user's password):

```bash
docker compose exec -T -e ADMIN_EMAIL=ops@example.com -e ADMIN_PASSWORD='new-password' \
  backend npx tsx scripts/create-admin.ts
```

## 6. Google sign-in

Configured inside the app, stored in the database, no restart needed:

1. Google Cloud Console → Credentials → Create OAuth 2.0 Client ID → Web application. Add the exact origin you open Solvro on (for example `http://solvro.internal:8090`) as an Authorized JavaScript origin.
2. Solvro → Admin → Sign-in → paste the Client ID → add at least one allowed email domain → Save.

Sign-in stays disabled until both fields are set. A first-time Google user is created in the `PENDING` role with no permissions; an admin promotes them under Admin → Users.

## 7. Backup and restore

Back up with `pg_dump` (from `~/solvro`; the stack stays up and the dump is consistent):

```bash
docker compose exec -T postgres pg_dump -U solvro -Fc solvro > solvro-$(date +%F).dump
```

A file copy of the data volume while Postgres runs is **not** consistent: it can miss the last transactions or refuse to start. Use the volume copy only with the stack stopped (`docker compose down` first), for example to move a server.

Run the dump every night and keep the files off the server (`crontab -e`, as the user who installed Solvro):

```
15 2 * * * cd ~/solvro && docker compose exec -T postgres pg_dump -U solvro -Fc solvro > ~/backups/solvro-$(date +\%F).dump && find ~/backups -name 'solvro-*.dump' -mtime +30 -delete
```

Restore (from `~/solvro`; this replaces the database with the dump):

```bash
docker compose stop backend frontend
docker compose exec -T postgres psql -U solvro -d postgres -c 'DROP DATABASE solvro;' -c 'CREATE DATABASE solvro OWNER solvro;'
docker compose exec -T postgres pg_restore -U solvro -d solvro --no-owner < solvro-YYYY-MM-DD.dump
docker compose up -d
```

Test a restore once after the first install, on a spare machine or a second database, so the first real restore is not the first attempt. Take a dump before every upgrade.

Also keep a copy of `~/solvro/.env`: it holds `SECRETS_KEY`, without which the stored iTop and Outline tokens in a restored database cannot be read (users would connect them again), and `JWT_SECRET`. Store it with the dumps, with the same care.

## 8. Logs

```bash
docker compose logs -f backend      # API, JSON lines
docker compose logs -f frontend     # nginx access and error log
docker compose logs -f postgres
```

To raise the API log level, set `LOG_LEVEL: debug` in `~/solvro/docker-compose.yml` and `docker compose up -d`. The next `setup.sh` run resets it to `info`.

Container logs rotate: each container keeps at most 5 files of 10 MB (the `logging` block in the compose file), so a busy API cannot fill the disk.

## 9. Fresh install on a server that already has Solvro

`setup.sh` treats a server **without** `~/solvro/.env` as a fresh install and **deletes the `solvro_pgdata` volume** to start clean. Since 2026-10-22 it first checks whether that volume already exists: if it does, the script stops with an error before it writes anything, and deletes the volume only when you run it as `FORCE_FRESH=1 bash setup.sh`. The same check protects you when the script runs as a different Unix user than the one who installed Solvro (`~/solvro/.env` is per user; the volume is shared by the whole host). If you lose `.env` on a server with data, restore `.env` from your backup before running the installer, or move the volume aside first:

```bash
docker volume create solvro_pgdata_keep
docker run --rm -v solvro_pgdata:/from -v solvro_pgdata_keep:/to alpine cp -a /from/. /to/
```

## 10. The backend restarts forever after an upgrade

The backend runs `prisma migrate deploy` before it starts. A migration that fails half-way leaves a failed entry in the `_prisma_migrations` table, and every later start refuses to continue (`docker compose logs backend` shows `P3009`). The old schema is partly changed, so do not just retry.

1. Stop the loop: `docker compose stop backend`.
2. Read the failing migration's name from the log.
3. Restore the dump you took before the upgrade (section 7), **or**, if you know the migration can be re-run safely, mark it rolled back and start again:

```bash
docker compose run --rm backend npx prisma migrate resolve --rolled-back <migration-name>
docker compose up -d backend
```

4. If it fails again, keep the stack stopped, keep the logs, and ask for support with the migration name and the log lines.

## 11. TLS

Solvro itself serves plain HTTP on the website port. Anyone on the network path can read the session token, so put TLS in front before people sign in from a network you do not control. Keep `BIND_ADDR=127.0.0.1` and let the TLS front talk to `127.0.0.1:<FRONTEND_PORT>`. Two ways:

**Caddy on the same server** (automatic certificate from Let's Encrypt; the name must resolve to this server and ports 80/443 must be reachable from the internet, or use an internal CA with `tls internal`):

```
# /etc/caddy/Caddyfile
solvro.example.com {
    reverse_proxy 127.0.0.1:8090
}
```

Set `FRONTEND_PORT=8090` (so Caddy can own 80/443), `APP_URL=https://solvro.example.com`, run `bash setup.sh` again. The compose default `TRUST_PROXY=loopback, uniquelocal` already trusts a proxy on this host.

**Cloudflare Tunnel** (no inbound port at all; Cloudflare terminates TLS):

```bash
cloudflared tunnel create solvro
cloudflared tunnel route dns solvro solvro.example.com
# config.yml: ingress: - hostname: solvro.example.com  service: http://127.0.0.1:8090
cloudflared tunnel run solvro
```

Set `APP_URL=https://solvro.example.com`. The tunnel makes Solvro reachable from the whole internet: put a Cloudflare Access policy (allowed emails or groups) on the hostname, because only the in-app login protects it otherwise. `TRUST_PROXY=loopback, uniquelocal` is right here too (the tunnel connects from this host).

Either way, Google sign-in needs the `https://` address added as an Authorized JavaScript origin (section 6).

## 12. Upgrading Postgres

The stack pins `postgres:15`. A newer major version does not start on a data directory written by an older one. To move: take a `pg_dump` (section 7), stop the stack, remove the volume (`docker volume rm solvro_pgdata` — this is the one time it is intended), change the image tag in the compose file, start Postgres, and `pg_restore` into it. Do this only with a tested dump in hand.

