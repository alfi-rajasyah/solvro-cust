# Guest link address, deadlocks and plain conflict messages

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/guest-link-address-and-locks.md`
Lane: P (wave 4 of the 2026-11-19 issue sweep; run in parallel with another stream on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-132 | Share-link create returns `baseUrl` (`APP_URL`; null when unset or loopback); the guest link and the Outline embed link use it, else the browser address. No separate public-base-URL setting |
| ISS-176 | Epic delete row-locks the epic's tasks; PATCH /tasks takes the task-order lock for a non-null epicId or sectionId; the admin status save takes per-project order locks (ascending id) after exclusive 7301, within a 15 s budget and a 30 s transaction |
| ISS-177 | Shared `assertEpicOwnerCanSeeProject` (`lib/epicOwner.ts`) and `filterUsersWhoCanSeeProject` |
| ISS-180 | Label names trimmed in the create and rename schemas |
| ISS-181 | Customer name clash answers 409 `customer_exists` with a plain message (name index only; ISS-017's 409 unchanged) |
| ISS-030 | 22021 logs `{ pgCode }` only, neutral message |

`docs/CONFIGURATION.md` (`APP_URL` row) and the `setup.sh` APP_URL note updated.

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review plus instant spine review (`tasks.ts`, `projects.ts`, `queries.ts`, `setup.sh`): 1 blocker (a loopback APP_URL, the setup.sh default, would have produced guest links no one can open), 1 should-fix (CONFIGURATION.md) and 4 nits, all fixed and re-checked. Deferred: ISS-190.
- Delivery Gate: PASS. A guest link created in Share used the configured address (dev tunnel), not localhost; the link was revoked afterwards.
