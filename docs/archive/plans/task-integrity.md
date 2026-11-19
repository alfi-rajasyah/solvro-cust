# Task ordering, date and epic-owner checks

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/task-integrity.md`
Lane: P (wave 1 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-027 | `DELETE /tasks/:id` closes the sibling gap (`closeGap`) in the same transaction, under the project task-order lock |
| ISS-028 | `PATCH /tasks/:id` rejects a merged due day before the start day (calendar days, `utcMidnightOf`); milestones exempt |
| ISS-036 | Section and epic delete take the task-order lock first |
| ISS-003 | `PATCH /epics/:id` and `POST /projects/:id/epics` require an owner who can see the project, via the shared `filterActiveUsersWhoCanSeeProject` (`activeOnly: false`; inactive users stay allowed, ISS-029 is open) |

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review plus instant spine review (`tasks.ts`, `taskOrdering.ts`): no blockers; 4 should-fix (calendar-day compare, stale comments, epic create path, shared visibility helper) and 3 nits fixed and re-checked. Deferred: ISS-174 to ISS-177.
- Delivery Gate: not applicable, no visible change (backend only).
