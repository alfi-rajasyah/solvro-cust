# setup.sh and nginx

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/setup-and-nginx.md`
Lane: P (wave 2 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-163 | `setup.sh` passes `ITOP_ALLOW_PRIVATE_HOSTS` (default true) and `ITOP_SYNC_DISABLED` (default false) from `~/solvro/.env` |
| ISS-164 | A fresh install pulls the backend image before anything is written or wiped and stops with a `docker login ghcr.io` hint; an empty `APP_URL` prints a CORS warning |
| ISS-165 | `nginx.conf`: `/icons/` and `= /favicon.png` get `Cache-Control: public, max-age=86400` with the sibling security headers |

`ci/check-setup-guard.sh` covers the two new compose lines and a failing pull (nothing written, no volume removed). `docs/CONFIGURATION.md` synced by the docs-keeper.

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review plus instant spine review (`setup.sh`, `nginx.conf`): no blockers; 2 should-fix (the pull ran after the volume wipe; CONFIGURATION.md was stale) and 2 nits fixed. Deferred: ISS-184.
- Delivery Gate: not applicable, no visible change.
