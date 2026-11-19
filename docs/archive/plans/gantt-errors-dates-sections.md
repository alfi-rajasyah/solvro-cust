# Gantt errors, Dates cell and section permissions

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/gantt-errors-dates-sections.md`
Lane: P (wave 3 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-095 | `updateTask`/`updateSection`/`createDependency`/`deleteDependency` per-call `onError` replaced by `mutateAsync(...).catch(...)` |
| ISS-106 | TaskDatesCell button `invisible` while editing; focus returns only if nothing else took it |
| ISS-178 | `canManageSections` (`project:write`) gates Add section, section colour and section reorder; `canReorderResource` refuses section-row drops without it |

`docs/DESIGN.md` updated for `canReorderResource`.

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review plus instant spine review (`gantt-v2/`): no blockers; 2 should-fix (refocus stole focus after an outside click; refused section drops gave no feedback) and 3 nits fixed. Deferred: ISS-189.
- Delivery Gate: PASS. Dates editor open on a row (range shown once) in light and dark at 1440 px; the Gantt is desktop-only; Playwright on the dev stack.
