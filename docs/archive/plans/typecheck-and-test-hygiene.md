# Wider typechecks and test hygiene

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/typecheck-and-test-hygiene.md`
Lane: P (wave 2 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-136 | Frontend typecheck also runs `tsc -p tsconfig.node.json --noEmit` (vite.config.ts); include list pruned |
| ISS-139 | Backend `npm run typecheck` (`tsconfig.check.json`: src, test, scripts); `gates.sh`, `ci.yml`, the Ops line and the agent files use it; 3 test casts fixed |
| ISS-148 | Search contract tests: 100/101 chars, ordering, 8-item cap, literal underscore |
| ISS-137 | `search.spec.ts` waits for the search button before Ctrl/Cmd+K; anchored regex |
| ISS-142 | seededProject comment corrected |
| ISS-152 | date-picker and gantt-parity specs use the shared `createTask` |

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review: no blockers; 1 should-fix (agent files still named the old backend typecheck) and 1 nit fixed. Deferred: ISS-182, ISS-183.
- Delivery Gate: not applicable, no visible change.
