# setup.sh hardening — the 4 changes before the first customer install

Status: proposed 2026-09-18, **not approved**. Proposal page: https://claude.ai/artifact/XKDfct2hvMMHM7PtHedGae (section 6). Ships as one PR in this repository, tested on a fresh VM.

`setup.sh` was copied from the source repository unchanged on 2026-09-21. Today it pulls `:latest` with `pull_policy: always`, sets `CORS_ORIGIN: "*"`, has no registry-login step, and wipes `solvro_pgdata` on any run without `~/solvro/.env`.

## 1. Registry login check

Before `docker compose pull`, try to pull the backend image. On `401`/`403`, print the three-line `docker login ghcr.io -u <github-user>` instruction and stop. The script never prompts for, stores, or receives a token.

## 2. Version pin

Resolution order: `SOLVRO_VERSION` env → the `VERSION` file next to the script → error. Store the tag as `IMAGE_TAG` in `~/solvro/.env`; the compose file references `ghcr.io/alfi-rajasyah/solvro-cust-backend:${IMAGE_TAG}` and the same for the frontend. Drop `pull_policy: always`.

Re-run on an existing install: compare the stored `IMAGE_TAG` with the target; print `Existing install detected: v1.0.0 → target v1.1.0`, confirm (`Upgrade? [Y/n]`, auto-yes without a tty), then pull and restart. Same target = restart only.

## 3. CORS

Set `CORS_ORIGIN` to the app URL (from `BIND_ADDR` + `FRONTEND_PORT`, the same value `app_url()` prints) instead of `*`. The website forwards `/api/*` inside the Docker network, so same-origin is enough.

## 4. Wipe guard

On a fresh install (no `~/solvro/.env`), if the `solvro_pgdata` volume already exists, refuse and print how to back it up, unless `FORCE_FRESH=1` is set.

## Acceptance

- Fresh VM, test GitHub account with read on the repo and both packages: steps 01–05 of the proposal's customer journey pass.
- Without `docker login`: the script stops at change 1 with the instruction, before writing anything to `~/solvro`.
- `~/solvro/.env` present + same `VERSION`: no pull prompt, stack restarts.
- Volume present + no `.env` + no `FORCE_FRESH`: refuses, volume untouched.
- `bash -n setup.sh` and `shellcheck setup.sh` clean.
