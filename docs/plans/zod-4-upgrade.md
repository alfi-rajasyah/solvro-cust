# Upgrade the backend from zod 3 to zod 4 (ISS-004)

Status: in progress (started 2026-11-24 @ `102ea27`)
Archive path: `docs/archive/plans/zod-4-upgrade.md`

## Goal

Move `backend/` from zod 3 to zod 4, so the memory-exhaustion advisory GHSA-mrhx-c7xc-m3w5 leaves the `npm audit` output. No API behaviour changes: every route accepts and refuses the same bodies, and error responses keep their current shape.

## Scope

- `backend/package.json` and `backend/package-lock.json` (the lock is written inside the backend container only).
- The 41 files under `backend/src`, `backend/test` and `backend/scripts` that import `zod`.
- Spine files in scope: the routes and libs that validate with zod (`routes/tasks.ts`, `routes/projects.ts`, `http/auth.ts`, `routes/admin.ts` and others). Behaviour there must not change.
- Out of scope: `frontend/` (it has no zod dependency), new validation rules.

## Tasks

1. Install zod 4 in the backend container and update the imports and API calls that changed (error formatting such as `.flatten()`/`.format()`/`.errors`, `z.record` arity, `.strict()`/`.passthrough()`, string formats, `superRefine`, defaults on optional fields, error-map options).
2. Keep the JSON error body every route returns today. If zod 4 changes an issue message or path format that a client or test reads, map it back.
3. Run the backend typecheck and the backend vitest suite on the test database.

## Acceptance

- `npm audit --omit=dev` in `backend/` no longer lists the zod advisory.
- Backend typecheck passes; the backend vitest suite passes on `solvro_test`.
- No test assertion was loosened to make it pass; any changed assertion is named in the report with its reason.
