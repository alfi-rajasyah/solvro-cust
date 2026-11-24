# Replace fixed sleeps in the e2e suite with condition waits (ISS-146)

Status: in progress (started 2026-11-24 @ `102ea27`)
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
