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
| `CORS_ORIGIN` | `*` | Which browser origins may call the API directly. |
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

Back up (from `~/solvro`; the stack can stay up):

```bash
docker run --rm -v solvro_pgdata:/data -v "$PWD":/backup alpine \
  tar czf /backup/pg-$(date +%F).tgz -C / data
```

Restore (from `~/solvro`; this replaces the database with the backup):

```bash
docker compose down
docker run --rm -v solvro_pgdata:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/pg-YYYY-MM-DD.tgz -C /'
docker compose up -d
```

Keep backups off the server. Take one before every upgrade.

## 8. Logs

```bash
docker compose logs -f backend      # API, JSON lines
docker compose logs -f frontend     # nginx access and error log
docker compose logs -f postgres
```

To raise the API log level, set `LOG_LEVEL: debug` in `~/solvro/docker-compose.yml` and `docker compose up -d`. The next `setup.sh` run resets it to `info`.

## 9. Fresh install on a server that already has Solvro

`setup.sh` treats a server **without** `~/solvro/.env` as a fresh install and **deletes the `solvro_pgdata` volume** to start clean. If you lose `.env` on a server with data, restore `.env` from your backup before running the installer, or move the volume aside first:

```bash
docker volume create solvro_pgdata_keep
docker run --rm -v solvro_pgdata:/from -v solvro_pgdata_keep:/to alpine cp -a /from/. /to/
```
