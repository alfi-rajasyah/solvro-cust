# Solvro

Solvro is the delivery workspace for Technical Account Managers: projects, tasks (Kanban and Gantt), daily notes, weekly syncs, and customers.

This repository is what a Solvro customer needs to run it on their own server:

| File | Purpose |
|---|---|
| `setup.sh` | Installer and updater (also shipped inside the backend image) |
| `VERSION` | The release this repository installs |
| `OPERATIONS.md` | Ports, files on the server, environment, backup and restore |
| `SUPPORT.md` | How to reach support and what to include |
| `LICENSE.md` | The terms under which Solvro is licensed |
| Releases | Release notes per version, on this repository's Releases page |

The application ships as two container images on the GitHub Container Registry (GHCR): `ghcr.io/alfi-rajasyah/solvro-cust-backend` and `ghcr.io/alfi-rajasyah/solvro-cust-frontend`. The source code is in this repository as well; `README.md` describes it.

## Requirements

- A Linux server with Docker Engine and the Docker Compose plugin installed. `openssl` and `curl` must be present (both are on every common distribution).
- Outbound HTTPS access to `ghcr.io`.
- A GitHub account that Solvro has granted access to the two images (and to this repository, where the release notes are).
- A personal access token (classic) for that account with the scope `read:packages`. GitHub requires the classic kind for the Container registry. Create it at GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic).

## Install

**1. Log the server in to the registry once.** Use the GitHub account name, and the token as the password.

```bash
docker login ghcr.io -u <github-user>
```

Docker keeps the login in `~/.docker/config.json`, so updates do not ask again.

**2. Fetch the installer from the newest release and run it.** The installer ships inside the backend image, so no clone of this repository is needed. (The `stable` tag it fetches exists from the first release that includes the `solvro` command.)

```bash
docker run --rm --entrypoint cat ghcr.io/alfi-rajasyah/solvro-cust-backend:stable /opt/solvro/setup.sh > setup.sh \
  && bash setup.sh
```

It asks three questions:

| Prompt | Default | Notes |
|---|---|---|
| Admin email | — | The first admin account. Others are created inside the app. |
| Admin password | — | At least 8 characters. |
| Address people will open Solvro at | `http://localhost` | For example `https://solvro.acme.com`. The network settings follow from it (below). |

| Address | Solvro listens on | Use it when |
|---|---|---|
| `https://…` | `127.0.0.1:8090` | A TLS proxy (Caddy) or tunnel (Cloudflare) on this server forwards to Solvro. Port 80 stays free for the proxy. The installer prints where to point it. |
| `http://localhost` | `127.0.0.1:80` | Only this server, or through an SSH tunnel. |
| `http://<host or IP>[:port]` | `0.0.0.0` on that port (default `80`) | People reach the server directly on a trusted network. |

To choose the ports, bind address, Postgres port and Outline embedding yourself, run `bash setup.sh --advanced`, which asks for each one. Every setting can also be given as an environment variable (see [Command reference](#command-reference)); a value given that way is never asked for and always wins.

The installer then generates the database password, the signing secret and the secrets-at-rest key, writes `~/solvro/.env` and `~/solvro/docker-compose.yml`, pulls the images, starts the stack, waits for the API, creates the admin, and installs the `solvro` command. A first install takes about 2 minutes after the pull.

A fully non-interactive install:

```bash
ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='change-me' APP_URL=https://solvro.example.com bash setup.sh
```

**3. Open the address and sign in as the admin.**

With `http://localhost`, the app is reachable from the server only. From your workstation, open an SSH tunnel first (`ssh -L 80:localhost:80 <user>@<server>`), then open `http://localhost`.

If Solvro listens on `0.0.0.0`, keep the server behind a trusted network, VPN, or firewall. Only the in-app login protects it.

**TLS.** Solvro serves plain HTTP, and the session token travels in the clear. Before anyone signs in from a network you do not control, put TLS in front of the website port: Caddy on the same server, or a Cloudflare Tunnel. Both are described step by step in `OPERATIONS.md` section 11. Answering the address question with an `https://` address sets Solvro up for exactly that.

## Upgrade

```bash
solvro update
```

The installer adds the `solvro` command to the server. `solvro update` looks up the newest release, shows the installed and the new version with a link to the release notes, and asks before it changes anything. On yes it backs up the database to `~/solvro/backups/`, then runs that release's installer, which keeps your ports and secrets, pins the new release (`IMAGE_TAG` in `~/solvro/.env`), pulls its images and restarts. The database and every user stay. It never moves a server to an older release.

`solvro update --yes` skips the question (for scripts and scheduled jobs); without a terminal and without `--yes`, it stops. Backups are never deleted automatically; remove old ones from `~/solvro/backups/` yourself. All commands and options are in the [Command reference](#command-reference).

Each release has notes on this repository's Releases page. Read the **Action required** section before you answer yes.

A plain `docker compose pull` or `docker compose up -d` never changes the version.

**Servers installed before the `solvro` command existed** upgrade once the old way, which installs the command:

```bash
cd solvro-cust
git pull
bash setup.sh
```

Run the installer and `solvro` as the same user that installed Solvro (the one whose home holds `~/solvro`). If `solvro` is not found right after that, sign in again (Ubuntu adds `~/.local/bin` to `PATH` at login) or run `~/solvro/bin/solvro`.

## After install

**Google sign-in (optional).** Create an OAuth 2.0 Client ID in Google Cloud Console (Web application; add the exact URL you open Solvro on as an Authorized JavaScript origin). Then sign in as admin → Admin → Sign-in → paste the Client ID, add at least one allowed email domain, Save. No restart is needed. People who sign in with Google for the first time land in the `PENDING` role until an admin promotes them under Admin → Users.

**Change a setting later** (the address, ports, bind address, Postgres port, Outline embedding): `solvro config set KEY=VALUE`, for example `solvro config set APP_URL=https://solvro.acme.com`. It checks the value, saves it to `~/solvro/.env` and restarts only what the change affects. `solvro config` shows the current settings. See the [Command reference](#command-reference).

**Back up the database.** Run from `~/solvro` (the stack can stay up):

```bash
docker compose exec -T postgres pg_dump -U solvro -Fc solvro > solvro-$(date +%F).dump
```

Restore, a nightly schedule and what else to keep (`~/solvro/.env`) are in `OPERATIONS.md` section 7. Take a dump before every upgrade.

**Useful commands**, all from `~/solvro`:

```bash
docker compose ps                 # container status
docker compose logs -f backend    # follow the API log
docker compose restart            # restart every container
docker compose down               # stop (data stays in the solvro_pgdata volume)
```

## Command reference

### `solvro`

Installed by `setup.sh` in `~/solvro/bin/solvro` and linked into `/usr/local/bin` (when the installer can write there) or `~/.local/bin`. Run it as the user that installed Solvro.

| Command | What it does |
|---|---|
| `solvro update` | Upgrade to the newest release. Shows the installed and the new version with a link to the release notes, asks before changing anything, backs up the database to `~/solvro/backups/`, then runs that release's installer. Does nothing when already up to date; never moves to an older release. |
| `solvro update --yes` | The same without the question (`-y` also works). Needed when there is no terminal, e.g. in a scheduled job. |
| `solvro update --no-backup` | Skip the database backup. Combines with `--yes`. |
| `solvro config` | Show the server settings (never the secrets). |
| `solvro config get KEY` | Print one setting, or its default. |
| `solvro config set KEY=VALUE [KEY=VALUE …]` | Change settings, e.g. `solvro config set APP_URL=https://solvro.acme.com`. Every value is checked first (the same checks as the installer) and nothing is saved unless all pass, including that the website, API and Postgres ports differ. Then it saves them to `~/solvro/.env`, regenerates the compose file and restarts only the services the change affects. If that restart fails (for example, the new port is already taken), it restores the previous settings, starts the stack on them again and exits with an error. Values must be on one line. Changing `FRONTEND_PORT` or `BIND_ADDR` does not change `APP_URL`; it reminds you to set it too if the address people open changed. Keys: `APP_URL`, `BIND_ADDR`, `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`, `TRUST_PROXY`, `EMBED_FRAME_ANCESTORS`, `ITOP_ALLOW_PRIVATE_HOSTS`, `ITOP_SYNC_DISABLED` (the two iTop ones take exactly `true` or `false`; meanings in the `setup.sh` table below). The secrets and `IMAGE_TAG` cannot be set here. |
| `solvro config unset KEY` | Remove an optional setting: `POSTGRES_PORT` (stop publishing Postgres), `TRUST_PROXY` (back to the default), `EMBED_FRAME_ANCESTORS` (turn embedding off), `ITOP_ALLOW_PRIVATE_HOSTS` and `ITOP_SYNC_DISABLED` (back to the default `true` / `false`). |
| `solvro version` | Print the installed release. |
| `solvro backup` | Write a database dump to `~/solvro/backups/solvro-<release>-<date>-<time>.dump` (mode `600`). Restore is in `OPERATIONS.md` section 7. |
| `solvro help` | Print the command list (`-h` and `--help` also work). |

It exits non-zero on any failure, so scripts can rely on the exit code.

### `setup.sh`

| Command | What it does |
|---|---|
| `bash setup.sh` | No install yet: fresh install with the three questions above. Existing install (`~/solvro/.env` present): update to the release this copy of the script belongs to, without questions. |
| `bash setup.sh --advanced` | Fresh install that asks for every setting. |
| `bash setup.sh --help` | Print the options. |

Settings it reads from the environment (a fresh install saves them to `~/solvro/.env`; `OPERATIONS.md` and `docs/CONFIGURATION.md` describe each one in full):

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | asked | The first admin account (fresh install only). |
| `APP_URL` | asked; `http://localhost` (`--advanced`, or when `BIND_ADDR`/`FRONTEND_PORT` are given: built from them) | The address people open. On an update, passing it changes the saved value. |
| `FRONTEND_PORT` | from the address (`--advanced`: `80`) | The website port. |
| `BIND_ADDR` | from the address (`--advanced`: `127.0.0.1`) | The interface the website listens on: `127.0.0.1`, `0.0.0.0`, or one IP. |
| `BACKEND_PORT` | `3000` (`3001` when the address itself is on port 3000) | The API port, always on `127.0.0.1`. |
| `POSTGRES_PORT` | not published | Publish Postgres on `127.0.0.1` at this port. |
| `TRUST_PROXY` | `loopback, uniquelocal` | Which proxies the API believes for the client address. |
| `EMBED_FRAME_ANCESTORS` | empty (off) | Outline address(es) allowed to embed Solvro pages. On an update, passing it changes the saved value. |
| `FORCE_FRESH` | unset | `1` lets a fresh install delete an existing database volume (`OPERATIONS.md` section 9). |

## Support

See `SUPPORT.md`.
