# Replace fixed sleeps in the e2e suite with condition waits (ISS-146)

Status: shipped 2026-11-24
Archive path: `docs/archive/plans/e2e-condition-waits.md`

## Goal

The Playwright specs call `page.waitForTimeout(...)` about 125 times. Each fixed sleep slows the suite and can still lose a race. Replace each with a wait on the condition the sleep stands in for: a web-first assertion (`expect(locator).toBeVisible()`, `toHaveText`, `toHaveAttribute`), `page.waitForResponse` on the request the step triggers, or `expect.poll`. Spec intent and coverage stay the same.

## Scope

- `e2e/tests/*.spec.ts` and shared helpers under `e2e/`.
- Out of scope: `frontend/`, `backend/`, the Playwright config retry budget, test removal.

## Tasks

1. For each `waitForTimeout`, find what the spec waits for and replace the sleep with that condition. Where a sleep is load-bearing for drag-and-drop (dnd-kit activation delay, pointer moves), keep a short documented step or use the drag helper's own wait, and name each kept sleep in the report with its reason.
2. Run each changed spec on the local stack (desktop project), then the e2e cleanup.

## Acceptance

- `waitForTimeout` count drops from about 125 to only the documented, load-bearing ones.
- Each changed spec passes locally on its first attempt (no retry).
- The e2e cleanup ran after every local run.

## Outcome

- 124 `waitForTimeout` calls drop to 3, each with a comment: the `touchDrag` hold for dnd-kit's 250ms TouchSensor delay, a press-hold that Base UI needs before it arms its mouseup click, and outwaiting the 350ms Outline search debounce to prove no request fires.
- Playwright's `networkidle` fires once per document, so it cannot prove that nothing happened after an in-app action. `settleQuiet` in `e2e/fixtures/test.ts` watches `/api/` requests itself and returns after a quiet window; `settleAnimations` waits until a full frame passes with no finite animation running.
- Local runs, desktop with `--retries=0`: every changed spec passed; task-conflict and kanban-dnd passed 3 runs out of 3. Mobile: kanban-dnd and smoke passed. embed-views has 1 failure that the original code shares (its share link expects `localhost:5173`, and the dev stack returns its public host).
- Found on the way: ISS-218 (the conflict dialog can be open with no rows).
