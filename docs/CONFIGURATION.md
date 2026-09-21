# Solvro — Configuration Reference

This document is the single-page reference for **how Solvro is configured** across local development and production deployment. It comes in two layers:

- [Part 1 — High-level overview](#part-1--high-level-overview): the mental model in one page.
- [Part 2 — Detailed reference](#part-2--detailed-reference): every variable, port, file, and volume — what it is, where it's read, what happens if it's wrong.

For *what changed and why*, see [CHANGELOG.md](CHANGELOG.md). For *coding conventions*, see [CLAUDE.md](CLAUDE.md).

> This file is tracked and maintained by the `solvro-docs-keeper` agent. It's synced whenever a diff touches `backend/src/env.ts`, `docker-compose.yml`, `setup.sh`, `frontend/nginx.conf`, or `frontend/vite.config.ts`.

---

## Part 1 — High-level overview

### The three deployment shapes

Solvro has **three** ways to run, and each uses a different combination of the same building blocks:

| Shape | What it is | Compose file | Ports exposed to host | When to use |
|---|---|---|---|---|
| **Native dev** | Postgres in Docker, backend + frontend run with `npm run dev` on your laptop | `docker-compose.yml` (only `postgres` service started) | 5432 (pg), 3000 (backend, native), 5173 (vite, native) | Day-to-day coding |
| **Dockerised dev** | Everything in Docker, with hot-reload bind mounts | `docker-compose.yml` (full stack — `postgres` + `backend` + `frontend` + `velora-app` + `velora-cron`) | 5432, 3000, 5173, 3001 (Velora) | When you want a clean, host-agnostic dev environment |
| **Production** | Prebuilt GHCR images; nginx serves the frontend and reverse-proxies `/api/*`, but the backend is *also* published directly to the host | `~/solvro/docker-compose.yml` written by [setup.sh](setup.sh) on the server (not committed) | `FRONTEND_PORT` (default 80) + `BACKEND_PORT` (default 3000), both bound to `BIND_ADDR` (default `127.0.0.1`, loopback-only); Postgres optional via `POSTGRES_PORT` | The deployment host |

The same env vars drive all three; the difference is *which* compose file is running and *whether* the backend/frontend are containerised or native.

> **The Pipeline module is native code** — Prisma tables in Solvro's own database, `/opportunities` routes in the same Express backend, React pages in the same bundle. Production deploys carry NO Velora services. The dev stack's `velora-app`/`velora-cron` containers and the `velora` database are a read-only behavior reference and the one-time data source for [scripts/import-velora.ts](../backend/scripts/import-velora.ts) — they retire after cutover. Their build context is the sibling checkout `../VeloraApp`, a hard dev prerequisite until then; `docker compose up -d` fails without it.

### Three tiers, one network

```
┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
│  Frontend               │    │  Backend                │    │  Database               │
│  (Vite dev OR nginx)    │───▶│  Express + Prisma       │───▶│  PostgreSQL 15-alpine   │
│  port 5173 dev / 80 prod│    │  port 3000              │    │  port 5432              │
│  proxies /api/* ──────────────▶ strips /api prefix     │    │  volume: solvro_pgdata  │
└─────────────────────────┘    └─────────────────────────┘    └─────────────────────────┘
```

The frontend **never** calls the backend directly. It always calls **same-origin** `/api/*`, which is then reverse-proxied — by Vite's dev server in dev, or by nginx in prod. This is what makes the same frontend bundle work behind Cloudflare Tunnel, a TLS terminator, or a k8s ingress without rebuilding.

> The diagram's "port 5173 dev / 80 prod" is the *default* — production ports are configurable (`FRONTEND_PORT` / `BACKEND_PORT` / `BIND_ADDR`, see [2.13](#213--production-deployment-via-setupsh)), and the backend port is published to the host in both dev and prod, not internal-only.

### Configuration sources, in priority order

When the backend reads a value, it looks here in this order (last wins):

1. **`backend/.env`** — loaded by `dotenv/config` at the top of [backend/src/env.ts](backend/src/env.ts). Used by **native dev** only.
2. **`process.env`** — set by docker-compose's `environment:` block when running in Docker. Used by **dockerised dev** and **prod**.
3. **Zod schema defaults** in [backend/src/env.ts](backend/src/env.ts) — applied if the variable is missing entirely.

A missing or invalid env var **crashes the process at startup** with a printed Zod error. There is no silent fallback for required values (`DATABASE_URL`, `JWT_SECRET`).

### Frontend: zero env vars at runtime

The frontend has **no runtime env vars**. The compiled bundle uses the literal string `/api` as its API base and inherits the origin from `window.location`. The only build-time / dev-time variables are `VITE_API_PROXY_TARGET` — which only matters if you run Vite *inside* a container and need to point its dev proxy at `http://backend:3000` instead of `http://localhost:3000`.

### The Pipeline module

The Pipeline module (the SA opportunity tracker ported from Velora) is part of Solvro itself: `opportunities`/`opportunity_activities`/`opportunity_links`/`pipeline_import_logs` tables in the `solvro` database, `/opportunities` routes in the backend, `/pipeline` pages in the frontend, gated by six `pipeline:*` permission strings (the SA role is seeded with view/create/edit_own/delete_own). The only Velora-shaped things left are the dev stack's reference containers and the one-time migration script — see [2.16](#216--velora-pipeline-integration).

### Secrets discipline

- `JWT_SECRET` must be at least 32 chars, generated with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The default in `.env.example` is **a placeholder that will fail Zod validation** — this is intentional. (The dev stack also passes it into the reference `velora-app` container; nothing in production does.)
- `POSTGRES_PASSWORD` defaults to `solvro_dev` for local dev. **Rotate before any deployment.**
- `.env` files are `.gitignored`; only `.env.example` is committed.
- The dev-stack `docker-compose.yml` ships a fixed `JWT_SECRET=solvro-dev-jwt-secret-not-for-production-32-chars-minimum-here` so the container starts without an `.env` next to it. **Never use it outside your laptop.**

---

## Part 2 — Detailed reference

### 2.1 — Backend environment variables

Defined and validated in [backend/src/env.ts](backend/src/env.ts) (Zod). All other code imports `env` from `./env.js` rather than reading `process.env` directly.

| Variable | Required? | Default | Validation | Purpose / failure mode |
|---|---|---|---|---|
| `NODE_ENV` | no | `development` | enum: `development` \| `production` \| `test` | Toggles dev-only behavior (e.g. pino-pretty logs, stack-trace exposure). |
| `PORT` | no | `3000` | positive int (coerced) | The HTTP port `index.ts` binds to. Inside Docker the container always listens on 3000 regardless. |
| `DATABASE_URL` | **yes** | none | must be a URL | Prisma connection string. Crashes on startup if unset/invalid. |
| `JWT_SECRET` | **yes** | none | string, **min 32 chars** | HMAC key for issued tokens. Anything shorter is rejected by Zod. **Rotate before deploy.** |
| `JWT_EXPIRES_IN` | no | `8h` | string (passed to `jsonwebtoken`) | Token lifetime. Accepts the `jsonwebtoken` shorthand (`60`, `"2 days"`, `"10h"`, `"7d"`). |
| `CORS_ORIGIN` | no | `http://localhost:5173` | string | Comma-separated origin allowlist. The literal value `*` (after trim) enables `cors({ origin: true })`. |
| `LOG_LEVEL` | no | `info` | enum: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | Pino level threshold. |

> Looking for Google OAuth config (Client ID, allowed domains)? It's **not** an env var — it's admin-managed in the database. See [2.9](#29--auth--rbac-configuration).

#### Database URL format

```
postgresql://<user>:<password>@<host>:<port>/<db>?schema=public
```

- **Native dev** → `postgresql://solvro:solvro_dev@localhost:5432/solvro?schema=public`
- **Inside Docker** → `postgresql://solvro:solvro_dev@postgres:5432/solvro?schema=public` (uses the compose service name `postgres`, not `localhost`)

The `?schema=public` query param is required by Prisma — if you drop it, migrations and queries silently target the user's default schema.

### 2.2 — Frontend environment variables

| Variable | Where it's read | Default | Purpose |
|---|---|---|---|
| `VITE_API_PROXY_TARGET` | [frontend/vite.config.ts](frontend/vite.config.ts) `server.proxy["/api"].target` | `http://localhost:3000` | Where the **Vite dev server** forwards `/api/*` requests. Only used in dev. Set to `http://backend:3000` when Vite runs *inside* the docker dev stack. |

That's all. The runtime bundle has no `VITE_*` vars baked in. **If you find yourself adding one, reconsider — the `/api` reverse-proxy pattern is what keeps the bundle environment-agnostic.**

### 2.3 — Postgres / database environment variables

Used by the `postgres` service in [docker-compose.yml](docker-compose.yml). When you run native-dev, these come from `.env`; when the compose stack is up, they're substituted into the container's environment.

| Variable | Default (`.env.example`) | Purpose |
|---|---|---|
| `POSTGRES_USER` | `solvro` | Initial superuser created on first container start. |
| `POSTGRES_PASSWORD` | `solvro_dev` | Password for that user. **Dev only — rotate before deploy.** |
| `POSTGRES_DB` | `solvro` | The database created on first start. |
| `POSTGRES_PORT` | `5432` | Host-side port mapping (the container always exposes 5432 internally). Override if 5432 is already taken on your laptop. |

> **First-start behavior**: postgres only initializes its data directory when the `solvro_pgdata` volume is empty. Changing `POSTGRES_PASSWORD` after the first start has no effect — you need to either drop the volume (`docker compose down -v` — destructive!) or `ALTER USER` from inside the container.

**The reference `velora` database (dev only)**: the dev `postgres` service also hosts a second logical database, `velora` (role `velora`, password `velora_dev`, both created by `docker-compose.yml`'s `configs:` init script on a fresh volume; an older volume needs the two one-shot commands in that file's header). It exists only so the reference `velora-app` container can run and so [scripts/import-velora.ts](../backend/scripts/import-velora.ts) has a dev-side source to rehearse against. Production has no such database — the Pipeline module's tables live inside `solvro` itself.

### 2.4 — GHCR image references (production only)

The **prod-shaped** `docker-compose.yml` written by [setup.sh](setup.sh) pulls prebuilt images with the registry path **hardcoded in the script**: `ghcr.io/alfi-rajasyah/solvro-cust-backend:latest` and `ghcr.io/alfi-rajasyah/solvro-cust-frontend:latest`. There is no env-var override for the owner or tag in the current script — both are always `latest` from the `alfi-rajasyah` GHCR namespace. Re-running `setup.sh` on an existing install does `docker compose pull && docker compose up -d`, which refreshes to whatever `latest` currently points at (see [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml) for what publishes it).

> **Drift note**: `.env.example` still documents `IMAGE_OWNER` / `IMAGE_TAG` variables from an earlier version of the deploy flow. Neither the committed dev `docker-compose.yml` nor the prod compose `setup.sh` writes reads them today — treat them as vestigial unless `setup.sh` is updated to honor them again.

### 2.5 — Services, ports, and volumes

#### Services in [docker-compose.yml](docker-compose.yml) (committed dev stack)

| Service | Image | Container | Internal port | Host port | Notes |
|---|---|---|---|---|---|
| `postgres` | `postgres:15-alpine` | `solvro-postgres` | 5432 | 5432 | Has a `pg_isready` healthcheck; the backend `depends_on` it with `condition: service_healthy`. |
| `backend` | built from `./backend` (target `dev`) | `solvro-backend` | 3000 | 3000 | Runs `prisma generate && prisma migrate deploy && prisma db seed && npm run dev`. Mounts `./backend` for hot reload. |
| `frontend` | built from `./frontend` (target `dev`) | `solvro-frontend` | 5173 | 5173 | Vite dev server with HMR. Mounts `./frontend` for hot reload. `VITE_API_PROXY_TARGET=http://backend:3000`. |
| `velora-app` | built from `../VeloraApp` (sibling checkout, build context) | `solvro-velora-app` | 3000 | 3001 | Next.js SA opportunity tracker (the Pipeline module). Self-migrates its schema on boot (`node scripts/migrate.mjs` entrypoint). `DATABASE_URL` points at the `velora` database/role on the shared `postgres` service. |
| `velora-cron` | `alpine:3.19` | `solvro-velora-cron` | — | — | Sidecar cron; installs one crontab line (`0 23 * * *`, UTC — no `TZ` set, alpine's default) that calls `velora-app`'s `/api/cron/auto-hold` with `CRON_SECRET`. No published port. Timezone intent unconfirmed — see [docs/ISSUES.md](ISSUES.md). |

#### Volumes

| Volume | Mounted at | Lifetime | Notes |
|---|---|---|---|
| `solvro_pgdata` | `/var/lib/postgresql/data` (postgres) | Survives `down`; lost on `down -v` | Postgres data directory — **now also holds the `velora` database**. **Treat `down -v` as destructive.** |
| `solvro_backend_node_modules` | `/app/node_modules` (backend) | Survives `down` | Keeps backend deps off the host filesystem so the bind mount of `./backend` doesn't shadow them. |
| `solvro_frontend_node_modules` | `/app/node_modules` (frontend) | Survives `down` | Same pattern for frontend. |
| `velora_uploads` | `/app/uploads` (velora-app) | Survives `down`; lost on `down -v` | Velora's uploaded files. Named `solvro_velora_uploads` in the prod compose file `setup.sh` writes. |

> The `node_modules` volumes are why a `package.json` change requires `docker compose up --build` (rebuild the dev image so the new deps land in the volume) — a plain `up` won't pick them up.

#### Ports — quick reference

| Port | Process | Direction |
|---|---|---|
| 5432 | postgres | Backend → DB |
| 3000 | backend (Express) | Frontend (via proxy) → Backend |
| 5173 | frontend (Vite dev) | Browser → Frontend (dev only) |
| 80 | nginx (prod only) | Browser → Frontend (prod) |
| 3001 | velora-app (dev-only reference container) | Browser → the old Velora UI, for behavior comparison |

> This table describes the dev stack (`backend` on 3000 is reached only via the frontend's proxy). In prod, `BACKEND_PORT` (default 3000) is published to the host directly, not just internally — see [2.13](#213--production-deployment-via-setupsh). `velora-app`'s 3001 exists in dev only — production deploys no Velora container.

### 2.6 — The `/api` reverse-proxy pattern (critical detail)

The frontend always calls `/api/*`. Two layers strip the prefix before forwarding to the backend:

**Dev** — [frontend/vite.config.ts](frontend/vite.config.ts):

```ts
server: {
  proxy: {
    "/api": {
      target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api/, ""),  // strips /api
    },
  },
}
```

**Prod** — [frontend/nginx.conf](frontend/nginx.conf):

```nginx
location /api/ {
  proxy_pass http://backend:3000/;   # the trailing / on the target strips /api
  ...
}
```

Backend routers stay mounted at `/auth`, `/projects`, `/tasks`, etc. — **without** an `/api` prefix. If you add a router, do **not** prefix it with `/api`; the proxy handles that.

### 2.7 — Database migrations

- **Dev**: `npm run prisma:migrate -- --name <slug>` from `backend/`. Always pass `--name`, otherwise it will hang waiting for interactive input.
- **Container startup (dev stack)**: the backend service's command runs `npx prisma migrate deploy && npx prisma db seed && npm run dev` — so a fresh container always lands with the schema migrated and seed data present.
- **Container startup (prod stack)**: same pattern as dev, seed included — `prisma migrate deploy && prisma db seed && node dist/index.js`. This is safe in prod because the seed creates no users (see [2.8](#28--default-seeded-data--first-admin-dev-and-prod)); see [setup.sh](setup.sh)'s `write_compose_file` function for the backend `command:`.
- **Schema convention**: tables/columns use `@map("snake_case")`, while the TS surface stays camelCase. Preserve this when editing [backend/prisma/schema.prisma](backend/prisma/schema.prisma).

### 2.8 — Default seeded data & first admin (dev and prod)

[backend/prisma/seed.ts](backend/prisma/seed.ts) seeds **no users**. It only upserts:

- **Five built-in roles**: `ADMIN` (`*` wildcard), `SA` (`project:read`), `TAM` (`project:read`, `project:write`, `task:read`, `task:write`), `STAKEHOLDER` (`project:read`, `report:read`, `project:view-all`), `PENDING` (empty permissions — the auto-provisioning role for first-time Google sign-ins, see [2.9](#29--auth--rbac-configuration)).
- The `AuthConfig` singleton (`id: "default"`), bootstrapped with an empty `googleAllowedDomains` array so Google sign-in starts disabled until an admin configures it.

The seed is idempotent (`upsert`) and re-running it never overwrites an admin-edited `AuthConfig` row.

**There are no default credentials.** The first admin user is created explicitly:

```bash
docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD=your-password \
  backend npx tsx scripts/create-admin.ts
# equivalently, from backend/ on the host: npm run admin:create
```

[backend/scripts/create-admin.ts](backend/scripts/create-admin.ts) upserts a user by email against the `ADMIN` role (errors if the seed hasn't run yet, since it looks the role up by name). It's idempotent — re-running with the same email resets that user's password, which doubles as the password-reset flow until a proper one exists. In production, [setup.sh](setup.sh) runs this automatically at the end of a fresh install using the `ADMIN_EMAIL` / `ADMIN_PASSWORD` it collected — see [2.13](#213--production-deployment-via-setupsh).

### 2.9 — Auth & RBAC configuration

- **Built-in roles** (hard-coded): `SA`, `TAM`, `ADMIN`, `STAKEHOLDER`, `PENDING`. `PENDING` is the auto-provisioning role for first-time Google sign-ins — empty permissions, so every screen renders a permission-denied empty state until an admin promotes the user from Admin > Users.
- **Custom roles**: created by admins via `POST /admin/roles` with an arbitrary `permissions: string[]`. The wildcard `"*"` short-circuits all permission checks.
- **JWT payload**: `{ sub: <userId>, role: <RoleName>, permissions: string[] }`. The `permissions` array is materialised at login from the user's role record.
- **Authorization gate to use** (in priority order):
  1. `requirePermission("project:write")` — the canonical pattern; works for both built-in and custom roles.
  2. `requireRole("ADMIN", ...)` — narrow legacy use only (e.g. `services.ts` writes).
  3. `requireAdmin` — router-level mount on the entire `/admin` tree.

#### Google OAuth (config lives in the database, not env vars)

Login supports two paths, both minting the same `{sub, role, permissions}` JWT: password (`POST /auth/login`) and Google (`POST /auth/google`, verified server-side via `google-auth-library`). Full routes live in [backend/src/routes/auth.ts](backend/src/routes/auth.ts).

**Unlike every other setting in this document, Google OAuth config is not an env var.** It lives in the `AuthConfig` DB singleton (`id: "default"`), managed by admins in-app at **Admin > Sign-in** (`GET`/`PATCH /admin/settings/auth` in [backend/src/routes/admin.ts](backend/src/routes/admin.ts)) — not in `backend/.env`, not in docker-compose. This is a deliberate surprise worth flagging to an operator: setting a `GOOGLE_CLIENT_ID` env var does nothing.

- Two fields make up the policy: `googleClientId` and `googleAllowedDomains` (an email-domain allowlist, up to 32 entries). **Google sign-in stays disabled until an admin sets both.**
- `GET /auth/google/config` is a public, unauthenticated endpoint the frontend polls to decide whether to render the Google button and what Client ID to initialize it with.
- `POST /auth/google` requires `email_verified: true` on the token and checks the token's `hd` claim (or the email's domain) against `googleAllowedDomains`; first-time sign-ins with no matching user (by `googleSub`, falling back to a match by `email`) are auto-provisioned into `PENDING` with `passwordHash: null`.
- Frontend: `@react-oauth/google`'s `GoogleOAuthProvider` wraps the button in [frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx), initialized at runtime from `useGoogleAuthConfig()` — never a build-time `VITE_*` var (consistent with [2.2](#22--frontend-environment-variables)).
- [backend/src/authConfig.ts](backend/src/authConfig.ts) caches the DB row in memory for a short TTL; `PATCH /admin/settings/auth` busts the cache immediately, so policy changes take effect without a restart.
- Post-deploy setup is manual: create an OAuth 2.0 Client ID in Google Cloud Console (Web application, add the deployed origin as an Authorized JS origin), then paste it + at least one allowed domain into Admin > Sign-in.

### 2.10 — Logging configuration

- **Library**: `pino` + `pino-http` request middleware.
- **Shared logger**: imported from [backend/src/logger.ts](backend/src/logger.ts) — never `new Logger()` ad hoc.
- **Level**: controlled by `LOG_LEVEL` env (default `info`; the dev compose stack sets `debug`).
- **Format**: JSON in prod (default pino), pretty in dev if pino-pretty is wired.

### 2.11 — Frontend storage & client-side state

| Storage key | Where it's written | Purpose |
|---|---|---|
| `localStorage["solvro.token"]` | [frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx) on login | JWT bearer; auto-injected by `apiRequest()` in [frontend/src/lib/api.ts](frontend/src/lib/api.ts). Cleared on logout/401. |
| `localStorage[<theme key>]` | [frontend/src/lib/theme.tsx](frontend/src/lib/theme.tsx) | Persisted light/dark preference. Read/write only via the theme provider — don't touch `document.documentElement.classList` directly. |

### 2.12 — Design-system configuration ("Technical Precision")

- **Theme source-of-truth is code, CSS-first (Tailwind v4)**: [frontend/src/index.css](frontend/src/index.css) defines every semantic color as a CSS custom property (`--primary`, `--surface`, etc. — light under `:root`, dark under `.dark`), then re-exposes them to Tailwind directly in an `@theme inline` block via `rgb(var(--token))`, which is what lets opacity utilities like `bg-primary/10` work. `frontend/tailwind.config.ts` and `frontend/postcss.config.js` were **deleted** (Plan A Task 1-2, 2026-07-24) — the Tailwind toolchain is now driven by the `@tailwindcss/vite` plugin registered in [frontend/vite.config.ts](frontend/vite.config.ts) rather than a JS/TS config file. A second `@theme inline` block in the same file bridges vendored shadcn/ReUI component class names (`bg-background`, `border-border`, etc.) onto these same tokens. Full token tables and behavioral rules live in [DESIGN.md](DESIGN.md) — don't duplicate values here; they drift.
- **Primary color** is Elitery Green, not the old spec blue: `#3aae51` in the dark theme, `#2d9042` in the light theme (darkened for WCAG contrast on white surfaces).
- **Dark is the default theme.** [frontend/src/lib/theme.tsx](frontend/src/lib/theme.tsx) resolves the OS `prefers-color-scheme` on first load and persists the user's explicit choice to `localStorage["solvro.theme"]`.
- **Sidebar is a fixed color in both themes**: `#232321`, hardcoded as the `sidebar` Tailwind token (not CSS-var-routed) — it does not flip with light/dark.
- Layout sizing tokens: `w-sidebar` (260px), `w-context-panel` (320px), `w-sidebar-collapsed` (4rem, icon-only rail).
- Typography: `font-display` and `font-body` both alias **Source Sans 3**; `font-mono` keeps Tailwind's default monospace stack; `data-mono` is a separate Source-Sans-3-with-`tnum` token for tabular numerics.
- Radius scale tops out small (`DEFAULT: 0.25rem`); large radii are forbidden by the spec.
- Elevation is 1px outlines + tonal shifts, not drop shadows — the one sanctioned exception is the `shadow-overlay` token for modals/drawers/floating panels.
- **Mobile breakpoint**: `md:` = 768px. The convention is desktop-first with `md:`-gated chrome — see CLAUDE.md "Mobile responsiveness" for the patterns.

### 2.13 — Production deployment via [setup.sh](setup.sh)

The committed `docker-compose.yml` is a **dev** file. Production is bootstrapped on the deployment host by running `bash setup.sh`, which behaves differently on a fresh install vs. a re-run.

**Fresh install** (no `~/solvro/.env` yet):

1. Collects `ADMIN_EMAIL` / `ADMIN_PASSWORD` and the host ports/bind address — `FRONTEND_PORT` (default `80`), `BACKEND_PORT` (default `3000`), `POSTGRES_PORT` (default: unset, stays unpublished), `BIND_ADDR` (default `127.0.0.1`, loopback-only; `0.0.0.0` publishes to the network) — either from env vars (so `ADMIN_EMAIL=... bash <(curl -sSL <url>)` works non-interactively) or interactive prompts read from `/dev/tty`.
2. **Auto-generates** `POSTGRES_PASSWORD` (`openssl rand -hex 24`) and `JWT_SECRET` (`openssl rand -hex 48`) — these are never prompted for.
3. Writes `~/solvro/.env` (`chmod 600`) and `~/solvro/docker-compose.yml` — a prod-shaped compose file with the GHCR image references hardcoded (see [2.4](#24--ghcr-image-references-production-only)).
4. Drops any prior `solvro_pgdata` volume (`docker compose down` + `docker volume rm` — **destructive**, intentional on a fresh install to clear stale postgres state), then pulls images and starts the stack.
5. Polls `GET /health` for up to ~2 minutes, then runs `scripts/create-admin.ts` inside the backend container with the collected admin credentials — a fresh install ends with a working login, no manual step required.

**Re-run** (`~/solvro/.env` already exists): skips all prompts, reuses the persisted ports/bind address, rewrites the compose file, `docker compose pull && docker compose up -d`. Does not touch the admin user or the database volume.

Backend container command in both cases: `prisma migrate deploy && prisma db seed && node dist/index.js` — see [2.7](#27--database-migrations).

**Ports**: `FRONTEND_PORT` (nginx — serves the SPA and reverse-proxies `/api/*`) and `BACKEND_PORT` (the Express API, published *directly*, not only reachable through nginx) are both bound to `BIND_ADDR` on the host. With the defaults that means only `127.0.0.1:80` and `127.0.0.1:3000` — reachable from the server itself or over an SSH tunnel, not the network. Postgres stays unpublished unless `POSTGRES_PORT` is set, and even then it's forced to `127.0.0.1` regardless of `BIND_ADDR` — the "expose to the network" flag never publishes the database.

Google sign-in still needs a manual post-deploy step, since it's DB-config not env-config (see [2.9](#29--auth--rbac-configuration)): create an OAuth Client ID in Google Cloud Console, then set it + an allowed domain via Admin > Sign-in in the running app — no restart or rebuild needed.

### 2.14 — Bind-mount layout (dev stack)

Bind mounts in the dev stack so code edits trigger hot-reload without rebuilding the image:

| Host path | Container path | Service |
|---|---|---|
| `./backend` | `/app` | backend |
| `./frontend` | `/app` | frontend |

The `node_modules` directories inside `/app` are intentionally shadowed by **named volumes** (`solvro_backend_node_modules`, `solvro_frontend_node_modules`) so a host-side `npm install` doesn't pollute the container's deps and vice versa.

### 2.15 — Testing, and what's intentionally **not** configured

- **Backend has a test runner**: `vitest` — `npm test` (= `vitest run`) from `backend/`. Don't call this unconfigured.
- **A Playwright e2e suite exists** in `e2e/` (own `package.json`, `playwright.config.ts`): `auth`, `kanban-dnd`, `pwa`, and `smoke` specs in `e2e/tests/`, run against desktop and mobile projects (`npm test` / `npm run test:desktop` / `npm run test:mobile` from `e2e/`).
- **`ci/docker-compose.ci.yml`** stands up an ephemeral stack (real Postgres, `runtime`-target backend/frontend images) for CI — credentials come entirely from the environment (`POSTGRES_PASSWORD`, `JWT_SECRET`; see `ci/.env.ci.example`), no literals in the file.
- **Frontend still has no unit test runner, and no linter/formatter is wired into either app.** Use `npm run typecheck` (frontend) or `npm run build` (backend = `tsc`) for frontend/type verification; don't fabricate a frontend `npm test`.
- **No Secure Ingestion Port webhook** — cancelled 2026-08-03; the user ended the SA-blueprint ingestion path, so Solvro has no Solution Architect ingestion route and none is planned. No env vars exist for it. Its spec is archived at [docs/archive/plans/secure-ingestion-port-spec.md](archive/plans/secure-ingestion-port-spec.md).
- **No WS / SSE push** layer yet — also PRD §6, also unimplemented (verified: no `ws`/`socket.io`/`EventSource` usage in `backend/src`).
- **No CI-side env** beyond GitHub Actions defaults — see [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml) for the image-publish flow that produces the GHCR artifacts `setup.sh` consumes.

### 2.16 — The Pipeline module (native) and the Velora reference stack

The Pipeline module is ordinary Solvro code — nothing here needs separate configuration. What IS operator-relevant:

- **Permissions**: six `pipeline:*` strings (`view`, `create`, `edit_own`, `edit_all`, `delete_own`, `delete_all`). The seed grants `view`/`create`/`edit_own`/`delete_own` to the built-in `SA` role; an "SA Manager"-style role with the `_all` pair is created by an admin in Admin → Roles. `ADMIN`'s `*` wildcard covers everything.
- **`xlsx` (SheetJS)** is a frontend dependency for the Excel/CSV import dialog, lazy-loaded only when the dialog opens. The container-written-lockfile trap (root CLAUDE.md) applies to it like any dependency.
- **Dev-only reference stack**: `velora-app` (the old tracker's UI at `:3001`, its own login) + `velora-cron` + the `velora` logical database exist in the dev compose file only, as a read-only behavior reference and the data source for the migration below. They retire after cutover, together with the `../VeloraApp` sibling checkout.
- **Handoff's customer picker needs `project:view-all`**: `POST /opportunities/:id/handoff` lets the caller pick which customer the new project links to, from the same visible set `customerVisibilityFilter` (`backend/src/lib/visibility.ts`) grants everywhere else — unowned customers, customers the caller owns as TAM, and customers of a project the caller can already see. A custom role that hands off won deals (the `pipeline:*` write permissions plus `project:write`) but lacks `project:view-all` therefore sees only unowned customers and customers of its own projects in that picker. Grant `project:view-all` in Admin > Roles to any role that should hand off to any customer.

#### One-time data migration (cutover)

[backend/scripts/import-velora.ts](../backend/scripts/import-velora.ts) copies opportunities, activity history, and links from a Velora database into the native tables, matching Velora profiles to Solvro users by email (never creating accounts).

```
docker compose exec \
  -e VELORA_DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<restored_velora_db>" \
  backend npx tsx scripts/import-velora.ts --yes
```

- The target is the backend's own `DATABASE_URL`; the script refuses to run unless that database is literally named `solvro` (or ends in `_test`), and refuses without `--yes`/`CONFIRM=1`.
- Idempotent per id — but a re-run is a **full overwrite sync**, not a merge. Never re-run after go-live once users have edited imported deals.
- The run report lists unmatched profiles (their deals import unassigned), over-length fields (imported verbatim; shorten them or the deal's first UI edit will be rejected), non-dense stage orders, and Hold deals missing a pre-hold stage.
- Won deals get `won_at` from their last update time — Velora never had a won-date column; this mirrors its own KPI proxy.

Cutover order: freeze edits in the standalone tracker → dump its database (plain format — it runs Postgres 16, Solvro's server runs 15) → restore it somewhere the backend container can reach → run the script → verify in the UI → retire the standalone `/opt/velora` stack and its GitLab CI deploy.

## Quick reference card

```
┌───────────────────────────────────────────────────────────────────────────┐
│  REQUIRED FOR ANY RUN:                                                    │
│    DATABASE_URL          (postgresql://… ?schema=public)                  │
│    JWT_SECRET            (≥ 32 chars; generate with node -e crypto)       │
│                                                                           │
│  NATIVE DEV BOOTSTRAP:                                                    │
│    cp .env.example .env                                                   │
│    docker compose up -d postgres                                          │
│    cd backend && npm i && npm run prisma:migrate && npm run db:seed       │
│    npm run dev                            # backend on :3000              │
│    cd ../frontend && npm i && npm run dev # frontend on :5173             │
│                                                                           │
│  DOCKERISED DEV BOOTSTRAP:                                                │
│    docker compose up -d --build                                           │
│    # everything on :5432, :3000, :5173, :3001 (Velora)                    │
│    # needs a sibling checkout at ../VeloraApp (Velora build context)      │
│                                                                           │
│  PROD BOOTSTRAP (deployment host):                                        │
│    bash setup.sh          # prompts admin+ports; auto-gens secrets;       │
│                            # auto-creates the admin user on first install │
└───────────────────────────────────────────────────────────────────────────┘
```
