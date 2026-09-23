# Solvro — Solution-to-Project Lifecycle Engine

Solvro is a project management platform for **Technical Account Managers (TAMs)**. It covers the project delivery lifecycle in one high-density workspace and replaces two tools: a task tracker and a shared notes document.

## Overview

The lifecycle Solvro is built around:

1. A TAM runs the delivery — Kanban, Gantt, risks, and **daily notes** per project and per customer — and rolls the week up into **Weekly Sync** tables for Monday's read.
2. Leadership reads the **Executive** dashboard: every project across every TAM.

Everything is multi-user and permission-gated. What a person sees and can change is decided by their role's permission list, never by a hard-coded role name.

## Features

### Delivery workspace (per project)

Seven tabs under `/projects/:id`: Overview, List, Kanban, Gantt, Timeline, Risks, Services.

- **One task order, three views.** List, Kanban, and Gantt render the same manual order. A status change never moves a task's slot.
- **List** — sortable, filterable table with drag reorder, inline date-range editing, subtasks, labels, and comments.
- **Kanban** — drag-and-drop across To do / In progress / Done with per-column WIP limits (the count pill turns amber over the limit). On phones the columns become a swipeable pager with a "move to" sheet.
- **Gantt** — four zoom levels, weekend shading and Indonesian public holidays, collapsible phase rows, hard/soft dependency arrows drawn by drag, milestones, a manual critical-path flag, and a **baseline lock** that shows planned-vs-actual slip. Exports to Excel and PDF. Desktop-only; phones fall back to the List.
- **Timeline** — phase-level linear view, distinct from the task-level Gantt.
- **Phases (sections)** with colour, reorder, and duplicate; task duplicate (subtasks included); project-scoped labels.
- **Risk register** — category, probability × impact score, mitigation and contingency plans, open / mitigated / closed.
- **Services** — a service catalogue with assignments at both the customer and the project level, each tagged with the tools in use.

### Customers, notes, and the weekly rhythm

- **Customer directory** — each customer has an owning TAM, an account manager and solution architect of record (free-text contact names), service assignments, and its projects.
- **Daily Review** (`/daily-review`) — a weekly, per-customer page: dated notes per project, operations notes per customer for issues outside any project, an explicit "Mark reviewed" stamp, and actionable overdue-task and open-risk lists. One request loads the whole page.
- **Weekly Sync** (`/weekly-sync`) — two tables for Monday's read. **Mid-week**: one row per highlight with its own risk and action. **Reflection**: one row per achievement with its outstanding issue, lesson learned, next-week focus, and manager decision (rows that need a decision pin to the top). Each customer carries a Green / Amber / Red health and a Draft / Done status. Both forms draft themselves from the week's notes, and "Copy as table" puts the rows on the clipboard as TSV and HTML for pasting into a document.
- **Recent notes** — a seven-day feed of project and operations notes on the Overview page.
- Notes carry an `INTERNAL` / `CUSTOMER_FACING` visibility. Internal notes never reach an export or a search result.

### Portfolio and leadership

- **Overview** (`/overview`) — the signed-in user's portfolio calendar, status and task counts, and recent notes.
- **Executive** (`/executive`) — org-wide portfolio roll-up behind its own permission: an overdue-projects worklist and portfolio timelines for every project. Administrative container projects can be excluded from every roll-up.

### Platform

- **Authentication** — email/password (JWT, 8-hour default) and Google sign-in with an admin-managed domain allowlist. Unknown Google users are auto-provisioned into a zero-permission `PENDING` role until an admin promotes them.
- **RBAC** — permission-based, with admin-managed custom roles. Built-in roles: `ADMIN`, `TAM`, `STAKEHOLDER`, `PENDING`.
- **Admin** (`/admin`) — Users, Roles, Sign-in (Google client ID and allowed domains, editable without a redeploy), and Projects (bulk reassign).
- **⌘K command palette** — page navigation plus search across projects, tasks, and customers, scoped to what the caller may see.
- **PWA & mobile** — installable, precached app shell, usable down to 375 px.
- **Design system** — "Technical Precision": dark-first charcoal surfaces with a single green accent, light mode included, Source Sans 3 and Material Symbols.

### iTop integration

Solvro connects to an external [iTop](https://www.itophub.io/) ITSM instance, configured once at Admin > iTop:

- **Tickets** — a customer's iTop tickets appear on that customer's page in a Tickets tab, with a Board view whose columns follow iTop's own lifecycle (New, Assigned, Pending, Resolved, Closed); dragging a card sends the matching lifecycle step to iTop, and a "New ticket" button creates a ticket directly in iTop. A task's panel can pin one iTop ticket by reference — showing its live status and an "Open in iTop" link once the ticket is in the local snapshot — or create a new ticket directly from the task, prefilled with its title and description.
- **Time** — **Utilization** (`/utilization`, the old `/work-logs` URL redirects here) shows hours per customer per week drawn from iTop's Time Tracking extension; every TAM sees their own hours, and holders of the Executive-report permission also get "By TAM" and "By customer" views. A Start/Stop timer on the ticket panel — one running timer per user, shown as a compact pill in the top bar — logs a Time Tracking entry in iTop under the user's own identity the moment it's stopped.
- **Live sync** — an optional per-install webhook secret lets iTop's own "on ticket update" trigger nudge Solvro into an immediate sync instead of waiting for the next scheduled pull.
- **Actions from Solvro** — opt-in per install (Admin > iTop) and per TAM (a personal iTop token saved in Settings): once both are on, a ticket can be assigned, set pending, resolved, closed, reopened, or given a log entry straight from Solvro's ticket panel. Every write happens under the acting TAM's own iTop identity — iTop stays the owner of what a ticket can do and who can do it.

## Architecture

### Three tiers, one Docker network

```
┌──────────────────────────────┐            ┌──────────────────────────────┐          ┌──────────────────┐
│ Frontend                     │  /api/*    │ Backend                      │          │ Database         │
│ React 18 SPA                 │───────────▶│ Express 4 + Prisma 5 (TS)    │─────────▶│ PostgreSQL 15    │
│ Vite dev server / nginx prod │  prefix    │ REST · JWT · Zod · pino      │  Prisma  │                  │
└──────────────────────────────┘  stripped  └──────────────────────────────┘          └──────────────────┘
```

**Request path.** The browser only ever calls same-origin `/api/*`. The Vite dev server (development) or nginx (production) strips the `/api` prefix and forwards the request to the backend, whose routers mount bare (`/auth`, `/projects`, …). The compiled bundle therefore contains no runtime configuration and can sit behind any TLS terminator or tunnel unchanged.

### Backend (`backend/src/`)

| Layer | Files | Role |
|---|---|---|
| Bootstrap | `index.ts`, `app.ts`, `env.ts` | `createApp()` is split from the listener for testability. Env is parsed once with Zod; the process exits on a bad config. |
| HTTP plumbing | `http/auth.ts`, `http/validate.ts`, `http/errors.ts` | Bearer-token auth and permission gates, Zod validation of body / params / query, and one error handler that renders every failure as `{ error, code, details }`. |
| Routes | `routes/*.ts` | One router per resource. Every authenticated router calls `requireAuth` once at the top, then `requirePermission(...)` per mutating handler. |
| Domain helpers | `lib/visibility.ts`, `lib/portfolio.ts`, `lib/taskOrdering.ts`, `lib/duplicate.ts`, `lib/dateBoundary.ts`, `lib/isoWeek.ts` | Row-level visibility filters, the portfolio roll-up shared by Overview and Executive, dense sibling ordering for tasks, deep copy for tasks and sections, and the caller-local "today" contract. |
| Data | `prisma.ts`, `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts` | One shared Prisma client. Tables and columns are `@map`ped to snake_case; the TypeScript surface is camelCase. The seed upserts the four built-in roles and the auth-config singleton and creates no users. |

Security baseline: `helmet`, a CORS allowlist, a 1 MB JSON body limit, bcrypt password hashes, and structured request logging with pino. The API targets sub-200 ms responses. Page-level endpoints (Daily Review, Overview, Executive) fetch each sub-collection with one batched query keyed by the in-scope ids, so the query count stays flat as data grows.

### Frontend (`frontend/src/`)

| Layer | Files | Role |
|---|---|---|
| Routing & shell | `App.tsx`, `components/layout/` | React Router 6 routes under a persistent `Shell` (sidebar, top bar with ⌘K, and a project right-sidebar for the baseline lock and schedule export). `AuthGuard`, `AdminGuard`, and `ExecutiveGuard` wrap the gated routes. |
| Data access | `lib/api.ts`, `lib/queries.ts` | A single `apiRequest<T>` wrapper (bearer token from `localStorage`, base `/api`) and every TanStack Query hook in one module with namespaced query keys. Inline edits use optimistic updates with rollback. |
| Auth, theme, nav | `lib/auth.tsx`, `lib/theme.tsx`, `lib/navCommands.ts` | The signed-in user and `hasPermission`, the dark / light / system theme, and the single navigation catalogue that feeds both the sidebar and the command palette. |
| Pages | `pages/`, `pages/views/` | One component per route; project sub-views live in `views/`. |
| Feature components | `components/daily-review/`, `components/portfolio/`, `components/services/` | Feature UIs. Roll-up and analytics math lives in plain `.ts` modules with unit tests beside them; components only render. |
| Drag engines | `components/reui/`, `components/gantt-v2/`, `components/kanban-v2/` | The Gantt, Kanban, Sortable, and Data Grid engines are vendored ReUI source (in-repo, not npm packages) on top of dnd-kit, TanStack Table, and TanStack Virtual. Solvro's adapters and commit mappers translate between engine events and the API's task contract. |
| Primitives | `components/ui/` | shadcn-style primitives built on Base UI (`@base-ui/react`). |
| Theme | `index.css` | Tailwind CSS 4, CSS-first: every token lives in two `@theme inline` blocks and dark mode is a `@custom-variant`. There is no `tailwind.config`. |

The PWA layer (vite-plugin-pwa / Workbox) precaches the app shell and serves `/api/*` network-only, so cached data can never outlive a session.

### Data model (`backend/prisma/schema.prisma`)

- **Identity** — `User`, `Role` (a JSON permission list), `AuthConfig` (Google client ID and allowed domains, one row).
- **Delivery** — `Project` (TAM, customer, status, WIP limits, baseline lock), `Section`, `Task` (status, priority, dates, milestone and critical-path flags, baseline dates, parent for subtasks, dense `position`), `TaskDependency` (HARD / SOFT), `Label`, `Comment`, `Risk`, `ProjectReview`.
- **Customers & services** — `Customer`, `Service`, `CustomerService`, `ProjectService`.
- **Notes & weekly rhythm** — `ProjectNote`, `CustomerNote`, `WeeklyUpdate` with child `WeeklyHighlight` and `WeeklyAchievement` rows.

### Authorization model

- A sign-in returns a JWT whose payload is `{ sub, role, permissions[] }`. The permission list is copied from the role at sign-in. `*` is the wildcard that satisfies every check and is what makes a role an admin.
- **Permissions** — `project:view-all`, `project:read`, `project:write`, `task:read`, `task:write`, `report:executive`.
- **Built-in roles** — `ADMIN` = `*`. `TAM` = project read/write + task read/write. `STAKEHOLDER` = project read + view-all. `PENDING` = nothing.
- **Project visibility** (`lib/visibility.ts`) — `project:view-all` sees everything. Everyone else sees a project where they are the TAM, or the owning TAM of its customer. A **customer** is visible when the caller owns it, when nobody owns it, or when it has a visible project.
- **Hidden means 404.** A resource outside the caller's visibility answers `404 not_found`, not `403`, so its existence is not revealed. A `customerId` sent as a body field answers `400 customer_not_found` instead.
- **Executive is org-wide by design.** `report:executive` is itself the grant, so the visibility filter is not applied to that report.

## API

The backend is a JSON REST API. Routers mount without an `/api` prefix; the frontend's proxy adds and strips it. Every route except `GET /health`, `POST /auth/login`, `GET /auth/google/config`, and `POST /auth/google` needs an `Authorization: Bearer <jwt>` header.

### Conventions

- **Validation** — every body, params, and query object is parsed with a Zod schema declared at the top of the route file. A failure returns `400 validation_error` with the flattened Zod issues in `details`.
- **Errors** — always `{ error, code, details? }`. Prisma "record not found" maps to `404 not_found`, a unique-constraint hit maps to `409 conflict`, and anything unexpected is logged and returns `500 internal_error`.
- **Dates** — calendar-only columns (note dates, week starts, deadlines, request dates) travel as plain `yyyy-MM-dd` strings, never instants. Task start and due dates stay ISO instants. Routes that compute "overdue" or "this week" accept an optional `today=yyyy-MM-dd` query (the caller's local day) and fall back to the server's UTC day.
- **Partial saves** — `PATCH` routes and the weekly-update `PUT` follow one rule: a field that is present replaces, a field that is omitted stays, and an empty list clears.
- **Caps** — `GET /tasks` returns at most 200 rows, and search returns 8 hits per group.

### Endpoints

| Mount | Endpoints | Gate |
|---|---|---|
| `/health` | `GET /` | public |
| `/auth` | `POST /login`, `GET /google/config`, `POST /google`, `GET /me`, `POST /change-password` | sign-in routes public; the rest any signed-in user |
| `/users` | `GET /` — user directory for assignee and PIC pickers | signed in |
| `/overview` | `GET /?today=` — project and task counts plus the caller's portfolio rows | signed in, visibility-scoped |
| `/notes` | `GET /recent?today=` — the last seven days of project and operations notes | signed in, visibility-scoped |
| `/daily-review` | `GET /?week=YYYY-Www&today=` — the whole Daily Review page in one payload: customers, projects, notes, overdue tasks, open risks, review stamps, weekly updates | signed in, visibility-scoped |
| `/search` | `GET /?q=` — projects, top-level tasks, and customers; notes are never searched | signed in, visibility-scoped |
| `/holidays` | `GET /?year=` — Indonesian public holidays for the Gantt | signed in |
| `/customers` | `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `PUT /:id/services`, `GET` / `POST /:id/notes`, `PATCH` / `DELETE /:id/notes/:noteId`, `GET /:id/weekly-updates`, `PUT /:id/weekly-updates/:weekStart` | reads `project:read`, writes `project:write` |
| `/projects` | `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/baseline`, `PUT /:id/services`; nested `GET` / `POST` for `tasks`, `sections`, `risks`, `notes`, `dependencies`, `labels`; `PATCH` / `DELETE /:id/notes/:noteId`; `POST /:id/reviews`, `DELETE /:id/reviews/:reviewDate` | reads visibility-scoped; writes `project:write` (`task:write` for dependencies) |
| `/tasks` | `GET /` (filters `status`, `priority`, `assignedToId`, `labelId`, `customerId`, `overdue`, `topLevel`, `today`), `PATCH /:id` (fields, status, labels, reorder, re-parent, move between sections), `DELETE /:id`, `POST /:id/duplicate`, `GET` / `POST /:id/comments` | writes `task:write` |
| `/sections` | `PATCH /:id`, `POST /:id/duplicate`, `DELETE /:id` | `project:write` |
| `/labels`, `/dependencies` | `PATCH /:id`, `DELETE /:id` | `task:write` |
| `/risks` | `PATCH /:id`, `DELETE /:id` | `project:write` |
| `/services` | `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` | writes `project:write` |
| `/reports` | `GET /executive?today=` — org-wide portfolio rows | `report:executive` |
| `/admin` | `GET` / `POST /users`, `PATCH /users/:id/role`, `PATCH /users/:id/deactivate`, `POST /users/:id/reset-password`, `DELETE /users/:id`; `GET` / `POST /roles`, `PATCH` / `DELETE /roles/:id`; `GET` / `PATCH /settings/auth`; `GET /projects`, `PUT /projects/reassign` | `*` (admin wildcard) |

### Key flows

**Sign-in.** `POST /auth/login` takes an email and password; `POST /auth/google` takes a Google ID token, which the server verifies against the admin-configured client ID and allowed domains, creating a `PENDING` user on first sight. Both return a JWT and the user's profile. The frontend stores the token in `localStorage` and sends it as a bearer header on every call; an old token without a permissions claim is treated as having none.

**Task ordering.** Top-level tasks share one dense `0..n-1` `position` per project; subtasks share one per parent. A `PATCH /tasks/:id` that carries `position`, `parentTaskId`, or `sectionId` moves the task inside a single transaction: the old sibling list closes its gap and the new one opens a slot, so List, Kanban, and Gantt always agree. Baseline dates are not accepted on this route.

**Baseline.** `POST /projects/:id/baseline` copies every task's live start and due date into its baseline columns and stamps who locked the plan and when; `{ "clear": true }` resets both. The Gantt draws the baseline ghost bars, and the Daily Review reports the slip in days against it.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript 5, Vite 5, Tailwind CSS 4 (CSS-first), TanStack Query 5, TanStack Table 8, TanStack Virtual 3, React Router 6, Base UI, dnd-kit, Recharts, date-fns, react-day-picker, ExcelJS + jsPDF (Gantt export), SheetJS `xlsx` (import dialog, lazy-loaded), vite-plugin-pwa |
| Backend | Node.js 22, Express 4, TypeScript 5, Prisma 5, Zod, jsonwebtoken + bcrypt, google-auth-library, helmet, pino, date-holidays |
| Database | PostgreSQL 15 |
| Testing | Vitest — backend with supertest against a real `_test` database, frontend pure-logic modules; Playwright — end-to-end on desktop (1440×900) and mobile (iPhone 13 viewport) |
| CI/CD | GitHub Actions — typecheck of all three packages (the frontend suite runs twice, once under `TZ=Asia/Jakarta`), the backend suite on a Postgres service, Playwright desktop and mobile on a built production-shaped stack; GHCR images publish from `main` only after CI passes, and on `v*` tags |
| Deployment | Docker Compose, prebuilt GHCR images (`solvro-cust-backend`, `solvro-cust-frontend`), one-shot `setup.sh` installer |

## Getting Started

### Production deployment

On a server with Docker Engine and the Docker Compose plugin, logged in to `ghcr.io` (see `INSTALL.md`):

```bash
git clone https://github.com/alfi-rajasyah/solvro-cust.git
cd solvro-cust
bash setup.sh
```

The script prompts for an admin email and password and for the host ports (website `80`, API `3000`, both bound to `127.0.0.1` unless you choose otherwise; Postgres stays private). It generates `POSTGRES_PASSWORD`, `JWT_SECRET`, and `SECRETS_KEY` (the secrets-at-rest key for integration tokens — rotating it invalidates every stored token), writes `~/solvro/docker-compose.yml` and `~/solvro/.env`, pulls the GHCR images, starts the stack, and creates the admin. The backend container runs `prisma migrate deploy` and the seed on every start.

Every input can come from the environment instead of a prompt:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=change-me BIND_ADDR=0.0.0.0 FRONTEND_PORT=8090 \
  bash setup.sh
```

To upgrade, run `git pull` and then `bash setup.sh` again: the script detects the existing install, pulls new images, and restarts without prompting.

### Local development

Prerequisites: Node.js 22 and PostgreSQL 15 (a local instance or a `postgres:15-alpine` container).

```bash
# Backend
cd backend
cp .env.example .env          # DATABASE_URL; add JWT_SECRET (32+ characters)
npm ci
npx prisma migrate dev        # apply migrations and generate the client
npm run db:seed               # five built-in roles, no users
npm run dev                   # API on http://localhost:3000

# Frontend (second terminal)
cd frontend
npm ci
npm run dev                   # app on http://localhost:5173, /api proxied to :3000
```

Create the first admin. The seed creates no users, so there is no default login:

```bash
cd backend
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=change-me npm run admin:create
```

Google sign-in is configured inside the app (Admin → Sign-in), not through environment variables.

### Run the production-shaped stack locally

`ci/docker-compose.ci.yml` is the stack CI tests against: built images, nginx on `:8080`, the API on `:3300`.

```bash
cp ci/.env.ci.example ci/.env   # set POSTGRES_PASSWORD and JWT_SECRET
docker compose --env-file ci/.env -f ci/docker-compose.ci.yml up --build
```

### Tests

```bash
cd backend && npm test                          # Vitest + supertest
cd frontend && npm run typecheck && npm test    # tsc + Vitest
cd e2e && npm ci && npx playwright install chromium && npm test   # desktop + mobile
```

The backend test setup refuses any database whose name does not end in `_test`, then migrates it and truncates every table before the run. Point `DATABASE_URL` at a dedicated database such as `solvro_test`. Playwright defaults to `BASE_URL=http://localhost:8080` (the stack above) and signs in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from the environment, so create that admin with `admin:create` first. `npm run test:desktop` and `npm run test:mobile` run one project.

## Repository Layout

| Path | Contents |
|---|---|
| `backend/` | Express API (`src/routes`, `src/lib`, `src/http`), Prisma schema and migrations, seed, `scripts/` (`create-admin.ts`, `normalize-day-dates.ts`), Vitest suite in `test/` |
| `frontend/` | React SPA: pages and views, feature components, vendored drag engines, Base UI primitives, the CSS-first theme, and `nginx.conf` for the production image |
| `e2e/` | Playwright suite — auth, Kanban and List drag, Gantt, date picker, Daily Review, Weekly Sync, search, PWA, smoke |
| `ci/` | The production-shaped compose stack GitHub Actions builds and tests |
| `.github/workflows/` | `ci.yml` (merge gate) and `docker-publish.yml` (GHCR release) |
| `setup.sh` | One-shot production installer and updater |
| `CHANGELOG.md` | Running record of every change, Keep a Changelog style |

## Branches and releases

Work branches off `develop` and merges back by pull request; `develop` is the integration branch. `main` is the release branch: a merge into `main` runs CI, and only a green run publishes the `latest` images that `setup.sh` pulls. `v*` tags publish versioned images directly.
