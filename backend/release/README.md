# backend/release

Filled at publish time only: `.github/workflows/docker-publish.yml` copies the root `setup.sh` here before building, and the backend image's runtime stage copies this folder to `/opt/solvro/`. `solvro update` runs that copy of the installer (design: `docs/archive/plans/solvro-update-cli.md`). Only this README is tracked; local and CI builds carry no installer.
