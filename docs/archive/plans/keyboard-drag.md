# Keyboard drag on boards and reorder lists

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/keyboard-drag.md`
Lane: P (wave 3 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-078 | Kanban and iTop board: dnd-kit attributes moved to the focusable grip (Space, arrows, Space, Escape); grip focus ring per DESIGN.md §4 |
| ISS-079 | Sortable rows lose role=button/tabIndex 0; the handle carries the attributes; read-only rows are not tab stops |

3 `// SOLVRO PATCH` sites in each of `reui/kanban.tsx` and `reui/sortable.tsx`; the `gates.sh` counters are 3. New e2e case: keyboard drag on the Kanban board. `docs/DESIGN.md` updated.

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review plus instant spine review (`reui/`): no blockers; 4 should-fix (DESIGN.md stale, issues still open, raw-id announcements, identical grip names) and 3 nits; the docs and comment items fixed, the rest deferred: ISS-186 to ISS-188.
- Delivery Gate: PASS. Kanban grip keyboard focus ring and Space/Escape in light and dark at 1440 px and dark at 375 px; Playwright on the dev stack.
