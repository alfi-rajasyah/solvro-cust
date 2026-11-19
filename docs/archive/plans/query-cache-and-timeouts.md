# Service lists, Daily Review refresh, request timeouts, section chip

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/query-cache-and-timeouts.md`
Lane: P (wave 3 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-038 | Optimistic service-list saves on the real day-suffixed project/customer detail keys (cancel, snapshot, patch, rollback, invalidate by an exact-shape predicate) |
| ISS-060 | `useCreateTask` invalidates the Daily Review root |
| ISS-067 | `apiRequest` timeout: 30 s default, 60 s (nginx `proxy_read_timeout`) for the iTop write routes and the admin iTop settings, test and persons match; a timed-out write says to check whether the change was saved; never a 401 |
| ISS-109 | `reorderTasksLocally` recomputes the nested section from the sections cache (null when not cached) |

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review plus instant spine review (`queries.ts`): 1 blocker (the optimistic hooks read a cache key no query uses, so they never ran), 3 should-fix and 2 nits, all fixed and re-checked. Deferred: ISS-185.
- Delivery Gate: covered by tests (optimistic rollback on the real key; both timeout messages); the timeout copy cannot be triggered on the dev stack without a hung request.
