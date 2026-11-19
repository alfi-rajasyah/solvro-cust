# Label permissions and duplicate label names

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/label-permissions.md`
Lane: P (wave 2 of the 2026-11-19 issue sweep; one stream, run in parallel with two others on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-007 | `POST /projects/:id/labels` needs `task:write`, like label rename and delete |
| ISS-041 | A duplicate label name on create or rename answers 409 `label_exists` "A label with that name already exists" (`lib/labelConflict.ts`, matched on the name index only) |

ISS-012 (customer name, description and Outline link) was dropped from this stream: gating those fields on ownership broke the M1 pentest contract (`pentestRemediation.test.ts`: a TAM with a project under the customer may edit its other fields), so it needs a user decision.

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review plus instant spine review (`projects.ts`): no blockers, no should-fix; 2 nits fixed (narrowed, shared conflict match; visibility and message tests). Deferred: ISS-180, ISS-181.
- Delivery Gate: PASS. Duplicate label message in the task panel label picker, light 1280 px and dark 375 px; Playwright screenshots on the dev stack; the test label was removed afterwards.
