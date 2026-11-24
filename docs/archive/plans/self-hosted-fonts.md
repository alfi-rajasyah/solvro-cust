# Serve the app fonts from the app instead of Google (ISS-010)

Status: shipped 2026-11-24
Archive path: `docs/archive/plans/self-hosted-fonts.md`

## Goal

The SPA shell, including the guest pages under `/share/<token>`, loads Source Sans 3 and Material Symbols Outlined from `fonts.googleapis.com` and `fonts.gstatic.com`. After this change the browser loads both fonts from the app's own origin, so no page contacts Google. Text and icons look exactly as before.

## Scope

- `frontend/index.html` (drop the Google `preconnect` and stylesheet links), `frontend/src/index.css` (`@font-face` rules), font files under `frontend/public/fonts/` or `frontend/src/assets/fonts/`, `frontend/vite.config.ts` (drop the Google runtime-cache rules; let the precache include the fonts).
- If the bundled nginx (`frontend/nginx.conf`, spine) needs a cache rule for the font files, add one in the same style as the favicon rule.
- Out of scope: `backend/`, `e2e/`, any font, weight, size or icon change.

## Tasks

1. Fetch the exact font files Google serves today for the 2 stylesheet URLs in `index.html` (woff2, latin subsets that the app uses; Source Sans 3 variable 300..700; Material Symbols Outlined at opsz 24, wght 400, FILL 0, GRAD 0). Both fonts are under the SIL Open Font License or Apache 2.0; keep the licence text next to the files.
2. Declare them with `@font-face` (same family names, `font-display: swap`), remove the Google links and the Google cache rules.
3. Keep the icon font usable for every icon name the app uses (check the file is not a subset that drops icons).

## Acceptance

- No `fonts.googleapis.com` or `fonts.gstatic.com` string remains in `frontend/` source or built output.
- Frontend typecheck and unit tests pass; the Playwright smoke passes.
- Delivery Gate: text and icons render the same in both themes and at 375px, and the browser network log shows no request to a Google host.

## Outcome

- The fonts live in `frontend/src/assets/fonts/`, so Vite hashes them into `/assets/`, which the bundled nginx already caches as immutable; `frontend/nginx.conf` needed no change.
- The `.material-symbols-outlined` base rule that Google's stylesheet injected stays unlayered in `index.css`. Inside a Tailwind layer, utilities would win and about 260 icons would change size or display.
- Delivery Gate PASS, 2026-11-24: 6 pages (`/`, `/projects`, a project's Overview and Kanban, `/tasks`, `/admin`) in light and dark at 1280px and 375px. Every icon's name, computed size, display and box matched `develop` on all 24 page views; Google requests dropped from 24 to 0.
