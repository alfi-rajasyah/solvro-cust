# Design cleanup

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/design-cleanup.md`
Lane: P (wave 5; three parallel streams on disjoint files, shipped as one PR because two streams share `ServiceMappingList.tsx`)

## Changes

| Stream | Issues | Change |
|---|---|---|
| Tokens, shell, Admin | ISS-080, 083, 074, 047, 076, 070 (Admin) | light `primary-tint-text` #175f26 on primary-tint chips (pinned in `tokenContrast.test.ts`, axe exclusion removed); fixed `rail-text*` tokens for the sidebar; AuthLoading uses PageLoading; command palette class/radius and "Ctrl+K" off macOS; `roleLabel()` for the four built-in roles |
| Pages | ISS-085, 077, 086, 073, 072, 055 | data-mono tokens; shared skeleton on Overview and Project Overview; Portfolio radius and phone Today line; active tab scrolled into view only when the strip overflows; Risks Prob/Impact on ui/select (no-op picks send nothing) |
| Panels, cards, Gantt | ISS-070, 058, 063, 040, 089, 105 | type scale; Critical Path mark on /tasks and kanban subtasks; sync modals name, mark and focus the untitled card; uncustomized section colours match the Gantt (portfolio returns positions, ordered by position then id); Gantt drag clone and GanttDatePicker on shadow-overlay (SOLVRO PATCH) |

`docs/DESIGN.md` synced (tokens, rail rows, chip classes, elevation and dropdown whitelists).

## Close

- `gates.sh --performed-review=opus`: all gates passed except `playwright-smoke`, which fails only on GSI console errors because the dev database has a Google client ID (ISS-162); CI has none.
- Three phase reviews (one with the reui spine instant): no blockers; should-fix items fixed (custom role names, light token pin, tab-scroll page jump and missing dependency, no-op Risks PATCH, Executive section-order ties, stale sync-modal numbers, DESIGN.md drift). Deferred: ISS-194 to ISS-197.
- Delivery Gate: PASS. Overview, Executive, Customers, Admin, Risks, List, Tasks and Services in light and dark at 1440 px and 375 px (Playwright screenshots on the dev stack); the sync-modal error and Critical Path marks are covered by unit tests.
