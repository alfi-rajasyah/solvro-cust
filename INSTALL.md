# Solvro

Solvro is the delivery workspace for Technical Account Managers: projects, tasks (Kanban and Gantt), daily notes, weekly syncs, and customers.

This repository is what a Solvro customer needs to run it on their own server:

| File | Purpose |
|---|---|
| `setup.sh` | One-shot installer and updater |
| `VERSION` | The release this repository installs |
| `OPERATIONS.md` | Ports, files on the server, environment, backup and restore |
| `SUPPORT.md` | How to reach support and what to include |
| `LICENSE.md` | The terms under which Solvro is licensed |
| Releases | Release notes per version, on this repository's Releases page |

The application ships as two container images on the GitHub Container Registry (GHCR): `ghcr.io/alfi-rajasyah/solvro-cust-backend` and `ghcr.io/alfi-rajasyah/solvro-cust-frontend`. The source code is in this repository as well; `README.md` describes it.

## Requirements

- A Linux server with Docker Engine and the Docker Compose plugin installed. `openssl` and `curl` must be present (both are on every common distribution).
- Outbound HTTPS access to `ghcr.io` and `github.com`.
- A GitHub account that Solvro has granted access to. You send the account name to Solvro; Solvro grants it read access to this repository and to the two images.
- A personal access token (classic) for that account with the scopes `repo` and `read:packages`. GitHub requires the classic kind for the Container registry. Create it at GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic).

## Install

**1. Log the server in to the registry once.** Use the GitHub account name and the token as the password.

```bash
docker login ghcr.io -u <github-user>
```

Docker keeps the login in `~/.docker/config.json`, so upgrades do not ask again.

**2. Clone this repository and run the installer.** Git asks for the same account name and token.

```bash
git clone https://github.com/alfi-rajasyah/solvro-cust.git
cd solvro-cust
bash setup.sh
```

The installer asks for:

| Prompt | Default | Notes |
|---|---|---|
| Admin email | — | The first admin account. Others are created inside the app. |
| Admin password | — | At least 8 characters. |
| Website port | `80` | The port people open in the browser. |
| API port | `3000` | The backend. Always on `127.0.0.1`; the website's nginx reaches it internally. |
| Postgres host port | not published | Leave blank unless you need direct database access. Always bound to `127.0.0.1`. |
| Bind address | `127.0.0.1` | `127.0.0.1` = reachable from the server only. `0.0.0.0` = reachable on the network. |

It then generates the database password, the signing secret, and the secrets-at-rest key, writes `~/solvro/.env` and `~/solvro/docker-compose.yml`, pulls the images, starts the stack, waits for the API, and creates the admin. A first install takes about 2 minutes after the pull.

Every prompt can be answered from the environment instead, which makes the install non-interactive:

```bash
ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='change-me' BIND_ADDR=0.0.0.0 FRONTEND_PORT=8090 bash setup.sh
```

**3. Open the URL the installer prints and sign in as the admin.**

With the default bind address the app is reachable from the server only. From your workstation, open an SSH tunnel first:

```bash
ssh -L 80:localhost:80 <user>@<server>
```

then open `http://localhost`.

If you bind to `0.0.0.0`, keep the server behind a trusted network, VPN, or firewall. Only the in-app login protects it.

**TLS.** Solvro serves plain HTTP, and the session token travels in the clear. Before anyone signs in from a network you do not control, put TLS in front of the website port: Caddy on the same server, or a Cloudflare Tunnel. Both are described step by step in `OPERATIONS.md` section 11. With either, keep the bind address at `127.0.0.1` and set `APP_URL` to the `https://` address.

## Upgrade

Pull this repository and run the installer again. It detects the existing install, keeps your ports and secrets, pulls the new images, and restarts. The database and every user stay.

```bash
cd solvro-cust
git pull
bash setup.sh
```

Each release has notes on this repository's Releases page. Read the **Action required** section before you upgrade, and take a database dump first (`OPERATIONS.md` section 7).

## After install

**Google sign-in (optional).** Create an OAuth 2.0 Client ID in Google Cloud Console (Web application; add the exact URL you open Solvro on as an Authorized JavaScript origin). Then sign in as admin → Admin → Sign-in → paste the Client ID, add at least one allowed email domain, Save. No restart is needed. People who sign in with Google for the first time land in the `PENDING` role until an admin promotes them under Admin → Users.

**Change ports or the bind address later.** Edit `~/solvro/.env`, then run `docker compose up -d` from `~/solvro`. To publish or unpublish the Postgres port, edit `POSTGRES_PORT` in `~/solvro/.env` and run `bash setup.sh` again.

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

## Support

See `SUPPORT.md`.
