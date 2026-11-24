# Upgrade the frontend from React Router 6 to 7 (ISS-014)

Status: shipped 2026-11-24
Archive path: `docs/archive/plans/react-router-7-upgrade.md`

## Goal

Move `frontend/` from `react-router-dom` 6 to React Router 7, so the 2 router advisories leave the `npm audit` output. The app keeps its declarative `BrowserRouter` setup (no data router, no framework mode) and every route, redirect and link behaves as today.

## Scope

- `frontend/package.json` and `frontend/package-lock.json` (the lock is written inside the frontend container only).
- The 66 files under `frontend/src` that import from `react-router-dom`.
- `frontend/src/lib/safeRedirect.ts` keeps its checks.
- Out of scope: `backend/`, `e2e/`, any route or page change, data-router or framework-mode migration.

## Tasks

1. Turn on the v6 future flags one by one where they exist, fix what each flag changes (relative splat paths, `startTransition`, fetcher/form behaviour does not apply), then switch the dependency to React Router 7.
2. Replace `react-router-dom` imports with `react-router` (v7 ships the DOM exports there), unless a tested reason keeps the `react-router-dom` re-export package.
3. Run the frontend typecheck and the frontend unit tests.

## Acceptance

- `npm audit --omit=dev` in `frontend/` no longer lists the React Router advisories.
- Frontend typecheck and unit tests pass; the Playwright smoke and the touched e2e specs pass at integration.
- Delivery Gate: not applicable unless a visible change appears; navigation is checked by hand in both themes at integration.

## Outcome

- Task 1: the v6 future flags were not staged one by one. Each flag was checked by reading the code instead. `v7_relativeSplatPath` changes nothing: the 3 splat routes in `App.tsx` (`share/*`, `embed/*`, `*`) link and redirect only to absolute paths. `v7_startTransition` would change behaviour: v7 wraps every navigation in `React.startTransition`, so a lazy page that is not loaded yet would keep the old page on screen without the `PageLoading` skeleton. `frontend/src/main.tsx` sets `<BrowserRouter useTransitions={false}>` to keep the v6 behaviour.
- Task 2: every import now names `react-router`; `react-router-dom` is removed.
