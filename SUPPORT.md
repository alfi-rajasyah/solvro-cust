# Support

Support is by email: **<support-email>**. This repository does not take issues.

## What to include in a report

1. **Version.** From `~/solvro`:
   ```bash
   docker compose images
   ```
2. **Server.** Distribution and version, `docker --version`, `docker compose version`.
3. **Container status.**
   ```bash
   docker compose ps
   ```
4. **The last 200 lines of the API log.**
   ```bash
   docker compose logs --tail 200 backend
   ```
5. **What you did, what you expected, what happened.** A screenshot helps for anything in the browser.

Remove passwords and tokens before you send logs. `~/solvro/.env` is never needed in a report.

## Before you write

- **`docker pull` fails with `denied` or `403`.** The server is not logged in to `ghcr.io`, or the account has no access yet. Run `docker login ghcr.io -u <github-user>` with a classic token that has `read:packages`.
- **`git clone` asks for a password and refuses it.** Use the classic token as the password, not your GitHub password. The token needs the `repo` scope.
- **The installer says the backend did not come up.** Run `docker compose logs backend --tail 40` from `~/solvro`. A wrong `DATABASE_URL` or a port already in use shows there.
- **You changed a port and nothing happened.** Edit `~/solvro/.env`, then `docker compose up -d`. For `POSTGRES_PORT`, run `bash setup.sh` again.
