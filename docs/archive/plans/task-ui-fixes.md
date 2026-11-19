# Task form, task panel and section permissions

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/task-ui-fixes.md`
Lane: P (wave 1 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-037 | Create-mode parent picker offers top-level tasks only |
| ISS-046 | Subtask DONE checkbox disabled without task edit permission |
| ISS-059 | TaskPanel error alert at the top of the scroll area, scrolled into view |
| ISS-066 | TaskPanel shows "Could not load this task" with Retry instead of an endless loader |
| ISS-061 | List-view section actions require `project:write`; renaming "No section" also needs `task:write` |

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review: no blockers; 1 should-fix (scroll the alert into view) and 3 nits fixed. Deferred: ISS-178, ISS-179.
- Delivery Gate: PASS. TaskPanel load-error state (forced 500 on the tasks fetch) in light and dark, 1280 px and 375 px; Playwright screenshots on the dev stack. The permission gating is covered by unit tests (seeded roles never split the two permissions).
