# E2E conventions (Playwright)

- Two projects in `playwright.config.ts`: `desktop` (Desktop Chrome, 1440×900) and `mobile` (iPhone 13 viewport forced onto Chromium — CDP is required for touch-drag). `npm test` runs both; `npm run test:desktop` / `npm run test:mobile` split.
- `BASE_URL` defaults to `http://localhost:8080` — the built CI stack from `ci/docker-compose.ci.yml`. Against the dev server use `BASE_URL=http://localhost:5173`, but `pwa.spec.ts` fails there by design: vite-plugin-pwa serves the manifest/service-worker only in build/preview mode. That spec needs :8080.
- Use the shared fixtures in `fixtures/` (`seed.ts`, `test.ts` — seeded project + admin credentials) instead of hand-seeding inside specs.
- CI runs this suite in `.github/workflows/ci.yml`: boots the CI stack, waits on `:3300/health`, creates the admin via `create-admin.ts`, uploads traces on failure.
