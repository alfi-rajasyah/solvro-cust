# `solvro update` and a simpler fresh install

User decisions, 2026-11-04: an upgrade is one command, `solvro update`; it moves the server to the **newest tagged release** (never the moving `main` build); it **asks for confirmation** before changing anything (`--yes` skips the question for scripts). A fresh install needs no clone and asks three questions; the full question list stays behind `--advanced`. Both ship in one PR. `INSTALL.md` documents every command and option.

## Problem

Upgrading meant `cd solvro-cust && git pull && bash setup.sh`. The command operators reach for, `docker compose pull`, silently does nothing because `IMAGE_TAG` pins a release. A CLI that only pulled newer images would be worse: the first release that changes the compose file or adds a required `.env` setting would break the server.

## Design

1. **`stable` image tag.** `docker-publish.yml` adds `stable` to both images when the pushed tag is the highest final `vX.Y.Z` tag in the repository (no `-rc`-style suffix), so a backport tag never moves it backwards. `latest` keeps tracking `main`.
2. **The installer ships in the backend image.** The publish workflow copies `setup.sh` into `backend/release/` before building; the runtime stage copies that folder to `/opt/solvro/`. Local and CI builds carry only the placeholder `README.md`.
3. **`solvro` CLI**, written by `setup.sh` to `~/solvro/bin/solvro` on every install and update (so each release ships its own CLI), linked into `/usr/local/bin` when writable, else `~/.local/bin`.
   - `solvro update [--yes] [--no-backup]`: pull `backend:stable` and pin its image ID → read the version from the image's `package.json` → if it equals the installed `IMAGE_TAG`, check the backend really runs it, else refuse if older → confirm → pull `frontend:<version>` (a release still publishing fails here, before anything changes) → `pg_dump` to `~/solvro/backups/` → extract `/opt/solvro/setup.sh` from the pinned image, check its `SOLVRO_IMAGE_TAG` matches → run it (existing-install path) → print the result.
   - The CLI file is replaced by rename, never rewritten in place: the running `solvro update` is still reading it when the release's installer writes the new one.
   - `setup.sh`'s update path saves the new `IMAGE_TAG` only after its images are pulled.
   - `solvro config [get KEY | set KEY=VALUE… | unset KEY]` (user request, 2026-11-04): shows and changes `APP_URL`, `BIND_ADDR`, `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`, `TRUST_PROXY`, `EMBED_FRAME_ANCESTORS`. The validators, `.env` helpers and `write_compose_file` are `setup.sh`'s own, copied into the CLI with `declare -f` when it is written, so there is one implementation. All values are checked before anything is saved; then the compose file is regenerated and `docker compose up -d` restarts what changed. Secrets and `IMAGE_TAG` are refused.
   - `solvro version`, `solvro backup`, `solvro help`.
4. Versions stay pinned in `.env`: a restart or a stray `docker compose pull` never upgrades.

## Fresh install

- Fetch the installer from the image: `docker run --rm --entrypoint cat <backend>:stable /opt/solvro/setup.sh > setup.sh && bash setup.sh`. Downloaded to a file rather than piped into bash, so commands in the script that read stdin cannot swallow the rest of it, and `--advanced` can be passed. The token needs only `read:packages`.
- Questions: admin email, password, the address people open (`APP_URL`). Derived unless given as env vars: `https://` → `127.0.0.1:8090` (proxy or tunnel in front); `http://localhost`/`127.0.0.1` → `127.0.0.1`, the URL's port or 80; other `http://` → `0.0.0.0`, the URL's port or 80.
- `--advanced` keeps the previous prompts unchanged.

## Rollout

Servers installed before this release have no CLI and no `stable` tag exists yet: they upgrade once the old way (`git pull && bash setup.sh`) to the first release carrying this; from then on `solvro update`. The first `v*` tag pushed after merge creates `stable`.

## Out of scope

Rollback command; automatic scheduled updates; showing release notes in the terminal (needs GitHub API auth on a private repo).
