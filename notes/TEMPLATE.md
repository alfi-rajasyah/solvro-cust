# Solvro vX.Y.Z — YYYY-MM-DD

One sentence on what this release is for.

## Upgrade

```bash
cd solvro-cust && git pull && bash setup.sh
```

## Action required

Anything the operator must do before or after the upgrade. Write "None." when there is nothing.

## New

-

## Changed

-

## Fixed

-

<!--
Release checklist (before the notes):
1. Bump VERSION (vX.Y.Z), backend/package.json + package-lock.json (root
   "version" fields), frontend/package.json + package-lock.json, and
   SOLVRO_IMAGE_TAG in setup.sh — ci/check-version.sh fails until all agree.
2. Move the CHANGELOG entries from [Unreleased] under a new "## [X.Y.Z] — date".
3. Merge to main, then tag: git tag vX.Y.Z && git push origin vX.Y.Z — the
   docker-publish workflow builds ghcr images tagged vX.Y.Z, which the new
   setup.sh pins.

Rules for these notes:
- Written for the customer's operator and users. No internal vocabulary, no branch names, no PR numbers, no customer names.
- Every line names a screen or a behaviour the reader can see.
- Cut from the source CHANGELOG.md entries since the previous tag; leave out refactors and CI changes.
-->
