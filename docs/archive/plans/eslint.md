# ESLint for the frontend (ISS-143)

Status: shipped 2026-11-25 (written 2026-11-25 @ `7f7be0f`)
Archive path: `docs/archive/plans/eslint.md`

Lane: P (new dev dependencies). One phase, one task, one PR.

## Decisions (user, 2026-11-25)

- The user approved new frontend dev dependencies for ESLint.

## Scope

- Frontend only (`frontend/src`, vendored `reui/` included). The backend and e2e stay without ESLint.
- Rules: `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`, both `error`. No other rule is turned on, so the change does not become a style rewrite.
- The `@typescript-eslint` plugin is registered with its rules off, so the existing `@typescript-eslint/*` disable comments resolve.
- An existing `exhaustive-deps` finding gets a disable comment with a one-line reason. Do not change a dependency list in this phase: that changes behavior.
- `npm run lint` in `frontend/package.json`; a `Lint frontend` step in `.github/workflows/ci.yml`; a `frontend-lint` gate in `.claude/scripts/gates.sh`.

## Done when

- `npm run lint` passes on `develop` plus this change, and a hook with a missing dependency and no disable comment fails it.
- Note on `TaskFormModal.tsx` (the ISS-143 example): its reset effect keeps its disable, because it reads `editingTask` but depends only on `editingTask?.id` on purpose (GH #56). `exhaustive-deps` does not flag an extra dependency, so lint cannot stop the props object from being added back; the effect's comment stays the guard for that.
- CI and `gates.sh` run the lint.
- ISS-143 moves to the closed list in `docs/ISSUES.md`.

## Record

- Installed: `eslint` 10.15.0, `typescript-eslint` 8.74.0, `eslint-plugin-react-hooks` 7.1.1 (dev only).
- Lint found 8 existing `exhaustive-deps` sites and 0 `rules-of-hooks` sites. Each of the 8 got a disable comment with its reason; no hook code changed.
- Phase review (also the spine review for `reui/` and `gantt-v2/`): 0 blockers, 1 should-fix (a wrong disable reason in `data-grid-table-virtual.tsx`), 3 nits. All fixed.
- Accepted trade-off: `reportUnusedDisableDirectives` is off, because 7 old comments name rules that stay off. A disable left behind after its hook is fixed is not flagged.
- Delivery Gate: not applicable, no visible change.
