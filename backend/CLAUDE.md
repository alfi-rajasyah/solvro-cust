# Backend conventions (Express + Prisma + PostgreSQL 15)

Sub-200ms API response is a non-functional requirement — design queries and indexes accordingly.

- **Entrypoint**: `src/index.ts` boots; the app is built in `src/app.ts` (split for testability).
- **No `/api` prefix**: routers mount bare (`/auth`, `/projects`, …). The frontend's `/api` base still works because the vite dev proxy and prod nginx both strip `/api` before forwarding.
- **Env**: `src/env.ts` parses `process.env` via Zod and exits on failure. Import from `./env.js` — never read `process.env` directly.
- **Prisma**: single shared client `src/prisma.ts` — never `new PrismaClient()` in a route (standalone scripts under `scripts/` and `prisma/seed.ts` are the only exception). Tables/columns are `@map`ped snake_case; the TS surface is camelCase.
- **Auth**: `src/http/auth.ts`. `router.use(requireAuth)` once at the top of every authed router; authorize actions with `requirePermission("project:write" | "task:write" | …)`; `requireAdmin` gates `/admin`. JWT carries `{ sub, role, permissions[] }`; `hasPermission(user, "*")` is the wildcard short-circuit. Authorization is permission-based, never role-name-based — admins can create custom roles with arbitrary permission arrays.
- **Visibility**: `src/lib/visibility.ts`. `projectVisibilityFilter(user)`: `project:view-all` (or `*`) sees everything; everyone else matches `tamId OR` ownership of the project's customer (`customer.tamId`) — owning a customer grants the same full access as being the project's own TAM, not just a read. `customerVisibilityFilter(user)`: view-all sees every customer; everyone else sees a customer they own (`tamId`), an unowned customer (`tamId` null), or a customer with at least one visible project. Id-keyed routes use `ensureProjectVisible`/`ensureTaskVisible`/`ensureCustomerVisible` (404 on purpose, not 403 — don't reveal that a hidden resource exists); a `customerId` taken as a body field (a project) uses `isCustomerVisible` instead and answers 400 `customer_not_found`. Reuse these — never re-derive scoping ad hoc.
- **Validation**: `validate("body" | "params" | "query", schema)` from `src/http/validate.ts`; Zod schemas at the top of the route file; `z.coerce.*` for query/params.
- **Errors**: throw `new HttpError(status, code, message)` from `src/http/errors.ts`; the global handler renders `{ error, code, details }`.
- **Logging**: shared pino logger from `src/logger.ts`; honor `LOG_LEVEL`.
- **Migrations**: always `prisma migrate dev --name <slug>` — never edit committed SQL.

## Traps

- `prisma migrate dev` is interactive and hangs without a TTY: `docker compose exec -it backend npx prisma migrate dev --name <slug>`. Non-interactive fallback: `prisma migrate diff --script` into a hand-created `prisma/migrations/<timestamp>_<slug>/migration.sql`, then `migrate deploy` + `prisma generate`.
- Plain `docker compose exec backend npm test` inherits the container's dev `DATABASE_URL`. `test/globalSetup.ts` hard-refuses to run against it — it throws before migrating or touching any data unless the database name ends in `_test` — so this fails loudly instead of polluting the dev DB. Isolate:
  `TEST_URL=$(docker compose exec backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') && docker compose exec -e DATABASE_URL="$TEST_URL" backend npm test` (globalSetup auto-migrates `solvro_test`, then truncates every table so each run starts from a clean database — no manual drop/recreate needed).
- **Never point `--shadow-database-url` at the dev database** (trap confirmed 2026-09-24: it wiped every row in `solvro`, including the admin user, and the migration history had to be re-baselined). Prisma resets the shadow database. For the non-interactive `migrate diff` fallback create a throwaway database first (`docker compose exec -T postgres createdb -U solvro solvro_shadow`) and pass that URL, then drop it.
- After `prisma migrate dev` (or `migrate deploy`), the long-running `backend` container's already-loaded Prisma Client is stale until `docker compose restart backend` — a route that reads/writes a column the migration renamed or dropped 500s with "column … does not exist" until the container restarts and reloads the generated client.
