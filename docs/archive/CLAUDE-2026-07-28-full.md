# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is the shared contract read by the interactive session and every subagent in `.claude/agents/` (see [Agent Roster](#agent-roster)). Structure: **Guardrails** (invariants, user-owned) → **Facts** (current state, docs-keeper-synced) → **Ops** (day-to-day commands) → **Agent Roster**.

---

## Guardrails

MUST/NEVER invariants. This block is user-owned — `solvro-docs-keeper` may read it but must never edit it.

- **INTERNAL notes never appear in exports.** `ProjectNote.visibility` defaults to `INTERNAL`; only `CUSTOMER_FACING` notes may reach any export or customer-facing output. This is the single most load-bearing guardrail in the app — verify it on every change that touches `frontend/src/lib/export/` or the notes routes.
- **`Tasks.tsx` and its `/tasks` route must never be deleted.** Hidden from the sidebar only — the file and route stay intact.
- **Never `npm install gantt-task-react`** (or any npm Gantt library). The Gantt is the vendored ReUI engine in `frontend/src/components/reui/gantt/` + Solvro's layer in `frontend/src/components/gantt-v2/`; `frontend/src/lib/gantt/` is the export/data layer.
- **The future `POST /webhook/blueprint` must use API-key auth only.** It bypasses `requireAuth` entirely and must reject user JWTs — see [Secure Ingestion Port](#secure-ingestion-port-blueprint--tasks-not-yet-built) below.
- **Timeline tab (`/projects/:id/timeline`) stays.** Intentional phase-level view distinct from the task-level Gantt. Do not remove or defer it.
- **DESIGN.md is binding for all visual work.** Do not duplicate design rules here — read DESIGN.md directly; its frontmatter is canonical.
- **Changelog Discipline (mandatory).** Whenever you change code, configuration, schema, dependencies, or Docker/env in this repo, append an entry to [CHANGELOG.md](CHANGELOG.md) in the same turn. Keep a Changelog conventions (`Added`/`Changed`/`Fixed`/`Removed` under `[Unreleased]`, reverse-chronological). Each entry: what changed, file path(s), and why when non-obvious. Never silently amend or rewrite existing entries — append only. Do not skip for "small" changes.
- **Docs Discipline (mandatory).** Whenever a canonical decision changes, or a "not yet built" feature ships, update this file (CLAUDE.md) in the same turn — same discipline as the changelog rule above.
- **No agent or session ever commits or opens a PR on its own.** The orchestrator stages work and drafts the commit message; every commit and PR waits for explicit user approval.
- **Branch and PR flow: all development work branches off `origin/develop`, and every PR targets `develop` — never `main`.** Start each task on a fresh branch cut from up-to-date `origin/develop` (`git fetch origin` first — local `develop` is often behind, as the SessionStart hook warns); never stack a task's branch on another task's branch. `main` is the release branch: GHCR images build only on pushes to `main`, and prod state = `main`, so a PR into `main` (release promotion of `develop`) happens only on the user's explicit request. This overrides the session header's "you will usually use main for PRs" default.
- **Every opened PR is assigned to the user for review, immediately after opening.** Run `gh pr edit <number> --add-assignee alfi-rajasyah` in the same turn the PR is created. Assignee — not reviewer-request — is the mechanism because PRs here are authored as `alfi-rajasyah` and GitHub refuses review-requests from a PR's own author; in the rare case a PR is authored by a different account, additionally run `gh pr edit <number> --add-reviewer alfi-rajasyah`.

---

## Facts

Current-state inventory, synced by `solvro-docs-keeper` as the codebase changes.

### Product & domain

Solvro bridges Solution Architects (SAs) and Technical Account Managers (TAMs). SAs design blueprints in an external tool; those blueprints are POSTed via webhook into the Secure Ingestion Port, which validates and translates the payload into projects + tasks. TAMs operate on those projects via a high-density dashboard (Kanban + Gantt). Tasks generated from a blueprint are visually distinguished as **AI Breakdown** cards (amber glow) — first-class UX, not decoration.

**The core TAM loop Solvro must nail:** TAM logs daily notes → app generates structured export per project → TAM drops export into external AI → sends summary to customer via WhatsApp or Email. Every feature decision should be evaluated against whether it serves this loop. Three tools Solvro replaces: **Asana** (task tracking), **Google Docs** (daily review notes), **Google Sheets + external AI** (progress reporting).

App name: Solvro. Solo-use productivity tool built for TAMs.

### Sidebar & routing

Sidebar order (`frontend/src/components/layout/Sidebar.tsx`): Overview → Projects → Customers → Daily Review → Reports → Executive (gated on `report:executive` permission) → Settings → Admin. `Tasks` and `Work Logs` are intentionally absent from the sidebar but stay routable (`/tasks`, `/work-logs`).

Top-level routes (`frontend/src/App.tsx`): `/login`, `/overview`, `/projects`, `/projects/:id`, `/customers`, `/customers/:id`, `/daily-review`, `/tasks`, `/work-logs`, `/reports`, `/executive` (behind `ExecutiveGuard`), `/settings`, `/admin` (behind `AdminGuard`).

Project sub-routes (`projects/:id/{overview,list,kanban,gantt,timeline,risks,services}`), rendered from `frontend/src/pages/views/`: `ProjectOverview`, `ProjectList`, `ProjectKanban`, `ProjectGantt`, `ProjectTimeline`, `ProjectRisks`, `ProjectServices`. When adding a new sub-view, register in both `App.tsx` (route) and `ProjectDetail.tsx` (tab list).

Shipped top-level pages (`frontend/src/pages/`): `Login.tsx`, `Overview.tsx`, `Projects.tsx` → `ProjectDetail.tsx`, `Customers.tsx` → `CustomerDetail.tsx`, `DailyReview.tsx`, `Tasks.tsx` (route intact, hidden from sidebar), `WorkLogs.tsx` (placeholder, see below), `Reports.tsx`, `Executive.tsx`, `Settings.tsx`, `Admin.tsx`.

### Auth

JWT + Google OAuth, both live. `POST /auth/login` (password), `POST /auth/google` (Google ID token verification), `GET /auth/google/config` (public — returns the runtime Client ID + whether OAuth is configured), `POST /auth/change-password`, `GET /auth/me` (`backend/src/routes/auth.ts`).

Google sign-in policy is DB-backed via the `AuthConfig` singleton (`id: "default"`): admin-managed `googleClientId` and `googleAllowedDomains[]`, editable from Admin without a redeploy. First-time Google sign-ins that don't match an existing user are auto-provisioned into the `PENDING` role (empty permissions — every screen renders a permission-denied empty state until an admin promotes the user from Admin > Users).

### Seeding & first admin

`backend/prisma/seed.ts` seeds **no users** — only the five built-in roles (`ADMIN` `*`, `SA` `project:read`, `TAM` `project:read/write` + `task:read/write`, `STAKEHOLDER` `project:read` + `report:read` + `project:view-all`, `PENDING` empty) and the `AuthConfig` singleton. Create the first admin via:

```bash
docker compose exec -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... \
  backend npx tsx scripts/create-admin.ts
```

There is no default seeded login.

### Testing

Backend: Vitest (`backend/vitest.config.ts`, tests in `backend/test/`), run via `npm test` (`vitest run`). E2E: Playwright suite in `e2e/tests/` (`auth`, `comments`, `date-picker`, `gantt-bar-labels`, `gantt-legend`, `gantt-parity`, `kanban-dnd`, `list-dnd`, `pwa`, `search`, `smoke`, `task-form-labels` specs), desktop (1440×900 Chrome) + mobile (iPhone 13 viewport, forced onto Chromium for touch-drag support via CDP) projects, run via `cd e2e && npm test`. `ci/docker-compose.ci.yml` runs the stack for CI. Frontend: Vitest (`frontend/vitest.config.ts`, node-environment pure-module tests matching `src/**/*.test.ts` — currently the kanban-v2 adapter/commit-mapper suite) via `npm test`, plus `npm run typecheck`.

**Operational caveats:** (i) Vitest run via `docker compose exec backend npm test` inherits the backend container's dev `DATABASE_URL`, pointing to the live dev database and risking test pollution (junk rows from prior branch work). For isolation, derive the test-DB URL from the container's real credentials rather than assuming a fixed password: `TEST_URL=$(docker compose exec backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') && docker compose exec -e DATABASE_URL="$TEST_URL" backend npm test` (globalSetup auto-migrates it). (ii) `pwa.spec.ts` fails against the dev server (`BASE_URL=http://localhost:5173`) because vite-plugin-pwa serves manifest/service-worker only in build/preview mode (`devOptions: false`) — the spec passes on the built CI stack (`:8080`). (iii) The isolated `solvro_test` database from caveat (i) is shared and never truncated, so it accumulates rows across branches over time; when `taskOrdering.test.ts`'s `"orders GET /tasks (cross-project) by position asc, then id asc"` test starts flaking again, drop and recreate the database rather than hunting for a new root cause — `docker compose exec postgres psql -U solvro -d solvro -c "DROP DATABASE solvro_test;"` then `docker compose exec postgres psql -U solvro -d solvro -c "CREATE DATABASE solvro_test;"` — and rerun; globalSetup's `prisma migrate deploy` re-applies the schema to the now-empty database.

### Reports & export (shipped)

Reports is the **output** screen; Daily Review is the **input** screen — do not conflate. `Reports.tsx` pulls live project data via a dynamically-imported `frontend/src/lib/export/projectExport.ts` (kept out of the main bundle, same pattern as the Gantt export layer) and offers both copy-to-clipboard and `.md` file download.

Export packet per project: identity (name, customer, SA — omitted when unassigned, TAM, phase, status), health (progress %, schedule variance vs. baseline), phase breakdown (per-section completion %), task signals (overdue/blocked/recently-completed counts, not the full task list), open risks (score + mitigation status), and `CUSTOMER_FACING` notes from Daily Review, chronological, last 14 days only. Output is structured markdown.

Executive dashboard (`Executive.tsx`, `GET /reports/executive`, gated on `report:executive`) is a separate, intentionally org-wide portfolio roll-up — it does not apply `projectVisibilityFilter` since the permission itself is the org-wide grant.

### Data model

PostgreSQL 15+ via Prisma (`backend/prisma/schema.prisma`). Models: `Role`, `User`, `AuthConfig`, `Project`, `Customer`, `Service`, `CustomerService`, `ProjectService`, `Task`, `TaskDependency`, `Section`, `Label`, `Comment`, `Risk`, `Blueprint`, `ProjectNote`.

Notable details:
- `Risk`: project-scoped, cascade-delete. `category` (`RiskCategory`: EXTERNAL/INTERNAL/TECHNICAL/ORGANIZATIONAL/FINANCIAL), `status` (`RiskStatus`: OPEN/MITIGATED/CLOSED), `probability`/`impact` ints (1–5). Score is computed live (`probability × impact`), not stored.
- `Task`: self-referential `parentTaskId` for unlimited subtask nesting (`topLevel=true` query param filters subtasks at list level); `isMilestone` boolean (user-controlled, backfilled once from the old startDate===dueDate heuristic); `position` = dense index in the project's single top-level order for `parentTaskId` null tasks (status does not partition; a status change keeps the slot — one canonical manual order shared by List/Kanban/Gantt drag-and-drop), subtasks ordered per-parent.
- `TaskDependency`: predecessor/successor edges powering Gantt connector arrows (`type`: HARD solid / SOFT dashed). Carries `sourceHandle`/`targetHandle` routing hints originally added for the Network Diagram view — that view was never built (see Guardrails), so these fields are currently unused by any shipped UI.
- `ProjectService` / `CustomerService`: service assignments at the project and customer level respectively, each with a free-text `tools[]` array.
- `Project`: `excludeFromPortfolio` excludes administrative containers (e.g. per-TAM "Opty Timelines") from portfolio roll-ups (Executive, Overview, overdue monitoring) while keeping them usable as projects. `baselineLockedAt`/`baselineLockedById` — when locked, backend snapshots each task's `startDate`/`dueDate` into `baselineStartDate`/`baselineDueDate` for Gantt planned-vs-actual deviation; `POST /projects/:id/baseline` with `{ clear: true }` resets all four fields. `saId`/`sa` are optional — a project can exist with no Solution Architect assigned; `POST /projects` no longer requires `saId`; `PATCH /projects/:id` accepts `saId: null` to disconnect the current SA; the FK is `ON DELETE SET NULL` (deleting the SA user un-assigns rather than blocking).
- `ProjectNote`: Daily Review notes, `visibility` (`NoteVisibility`: INTERNAL default / CUSTOMER_FACING), see Guardrails.
- `Comment`: child of `Task`, cascade-delete. Thread at `GET/POST /tasks/:id/comments`.

Sub-200ms API response is a non-functional requirement. Design queries and indexes accordingly.

### Backend conventions

- **Entrypoint**: `backend/src/index.ts` boots the server; app constructed in `backend/src/app.ts` (separate for testability).
- **Route prefix**: routers mounted **without `/api/` prefix** — paths are `/auth`, `/projects`, `/tasks`, etc.
- **Env vars**: `backend/src/env.ts` parses `process.env` via Zod and exits on failure. Import from `./env.js` — never read `process.env` directly.
- **Prisma client**: single shared instance at `backend/src/prisma.ts`. Never `new PrismaClient()` per route.
- **Auth & RBAC**: `backend/src/http/auth.ts` exports `requireAuth` (JWT bearer). Prefer `requirePermission("project:write" | "task:write" | ...)` for action authorization. `requireRole(...RoleName[])` used narrowly (e.g. `services.ts` ADMIN-only writes). `requireAdmin` gates the entire `/admin` tree. JWT carries `{ sub, role, permissions[] }`. `hasPermission(user, "*")` is the wildcard short-circuit. Every authed router calls `router.use(requireAuth)` once at the top.
- **Visibility filter**: `projectVisibilityFilter(user)` in `backend/src/lib/visibility.ts` (imported by `projects.ts`, `overview.ts`, etc.) — wildcard users (ADMIN + custom roles with `*`) and STAKEHOLDER see everything; TAM sees `tamId === user.sub`; SA sees `saId === user.sub`; custom roles without `*` only see directly-assigned projects. Reuse this helper — don't re-derive role-scoping ad hoc.
- **Validation**: `backend/src/http/validate.ts` exports `validate("body" | "params" | "query", schema)`. Define Zod schemas at the top of the route file. Coerce numbers/dates with `z.coerce.*` for query/params.
- **Errors**: throw `new HttpError(status, code, message)` from `backend/src/http/errors.ts`. Global `errorHandler` in `app.ts` renders JSON `{ error, code }` and unwraps Zod failures.
- **Logging**: `pino` + `pino-http`. Import shared logger from `backend/src/logger.ts`; honor `LOG_LEVEL` from env.
- **Migrations**: always use `prisma migrate dev --name <slug>` (never edit committed SQL). Schema uses `@map("snake_case")` table/column names; TS surface is camelCase.
- **Routes inventory** (`backend/src/routes/`): `auth`, `admin`, `users`, `customers`, `projects`, `tasks`, `sections`, `labels`, `services`, `holidays`, `risks`, `dependencies`, `overview`, `reports`, `search`, `health`. `risks.ts` exposes `PATCH /risks/:id` and `DELETE /risks/:id`; creation is nested at `POST /projects/:id/risks`. `dependencies.ts` exposes `PATCH/DELETE /dependencies/:id` for Gantt connector edges. `search.ts` exposes `GET /search` (global ⌘K lookup) — visibility-scoped via `projectVisibilityFilter` for the `projects`/`tasks` groups (top-level tasks only; subtasks excluded from v1), `customers` unscoped (matches `GET /customers`'s own `requireAuth`-only gate); `ProjectNote` is deliberately excluded from the response. Secure Ingestion Port webhook is **not yet** in this list.
- **Admin sub-tree** (`backend/src/routes/admin.ts`): mounted under `/admin` with `requireAdmin`. User CRUD (incl. role assignment) and role CRUD — admins can create custom roles with arbitrary permissions arrays, which is why `hasPermission` (not role-name equality) is load-bearing everywhere.

### Frontend conventions

- **Routing**: `frontend/src/App.tsx`. All authed routes are children of `<AuthGuard><Shell/></AuthGuard>`.
- **Layout**: `frontend/src/components/layout/` — `Shell` (orchestrator), `Sidebar` (collapsible left rail with `SidebarContext`), `TopBar`, `RightSidebar` (320px context panel, slide-toggleable from `ProjectDetail`). Fixed widths as Tailwind tokens `w-sidebar` (260px) and `w-context-panel` (320px), defined in the `@theme inline` block of `frontend/src/index.css`.
- **Path alias**: `@/` resolves to `frontend/src/`. Use it — no deep relative imports.
- **API layer**: `frontend/src/lib/api.ts` exposes `apiRequest<T>(path, opts)`. Auto-injects bearer token from `localStorage["solvro.token"]`, JSON-encodes bodies, throws `ApiError` on non-2xx. `BASE_URL` is `"/api"` — same-origin through reverse proxy. Never call `fetch` directly from a component or hook — always go through `apiRequest`.
- **Server state**: TanStack Query. All hooks in `frontend/src/lib/queries.ts`. Centralised query keys in `queryKeys`; admin hooks use separate `adminQueryKeys` — don't mix namespaces. Mutations driving inline cell edits use the optimistic-update pattern (`onMutate` → cancel + snapshot + optimistic write, `onError` → rollback, `onSettled` → server invalidate).
- **Auth context**: `frontend/src/lib/auth.tsx`; `AuthGuard` redirects unauthenticated users to `/login`.
- **Tailwind theme (v4, CSS-first)**: `tailwind.config.ts` / `postcss.config.js` are deleted. The runtime port of DESIGN.md now lives in the primary `@theme inline` block of `frontend/src/index.css` (semantic colors, radii, type scale, layout tokens) plus a second `@theme inline` block bridging to shadcn's semantic names (`background`, `card`, `popover`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`) for vendored `ui/`/`reui/` components. Both blocks must stay `inline` — a non-inline `@theme` freezes `var(--token)` resolution at `:root` (the declaring element), which breaks the subtree `dark` pins on `Login.tsx`/`Sidebar.tsx` (fixed 2026-07-25, see CHANGELOG). `@tailwindcss/vite` is registered in `frontend/vite.config.ts`. Dark mode is a `@custom-variant dark (&:where(.dark, .dark *))` in `index.css`, not a `darkMode` config key. When introducing new colors/sizes, add to the primary `@theme inline` block — don't inline arbitrary hex values in components.
- **UI primitives**: `frontend/src/components/ui/` (8 shadcn-style primitives — `button`, `calendar`, `checkbox`, `context-menu`, `dropdown-menu`, `popover`, `scroll-area`, `tooltip`). 7 of the 8 (all but `calendar`) are `@base-ui/react`-backed rewrites — `radix-ui` was removed from `frontend/package.json` entirely; `@base-ui/react` is the only headless-behavior stack. `cn()` combiner at `frontend/src/lib/utils.ts`. Bootstrapped via `frontend/components.json` (`iconLibrary: "lucide"`); re-running the shadcn/ReUI CLI strips vendor headers and `"use client"` — keep `// SOLVRO PATCH` markers in any hand-touched vendored file so re-pulls don't silently clobber them. `ui/popover.tsx` carries its first vendored patch (2 `// SOLVRO PATCH` sites, 2026-07-28): `PopoverContent` takes an optional `positionerClassName` prop applied to `PopoverPrimitive.Positioner` — z-index overrides must land there, not on the Popup, because Base-UI's Positioner carries an inline `transform` that creates its own stacking context.
- **Shared `DateField` (ReUI date-field swap — call-site migration complete; Task 5 e2e coverage shipped via `e2e/tests/date-picker.spec.ts`; the swap plan's task list is complete on `feat/reui-date-field`, not yet merged)**: `frontend/src/components/DateField.tsx` is a calendar-popover date field (`variant: "boxed" | "bare"`, `clearable`, day-string `value`/`onChange`, optional display-only `triggerLabel` prop — overrides the rendered trigger text with a caller-supplied string instead of `formatDisplay(value)`, for call sites whose resting label must match a different local format shown elsewhere for the same value) composing `ui/calendar.tsx` inside `ui/popover.tsx`, for single-date sites (paired START/DUE editing moved to the sibling `DateRangeField` below). Contract is a plain calendar day (`"yyyy-MM-dd"`), not an ISO instant — an earlier ISO-instant contract caused a picker walk-back a day east of UTC. ISO conversion happens only at call-site boundaries via `frontend/src/lib/dateField.ts` (see the `DateRangeField` bullet below for the full current helper inventory); persisted payload semantics (`Task.startDate`/`dueDate` as ISO instants) are unchanged, byte-parity with the legacy inline editors' `toInputValue`/`fromInputValue` pair. Re-clicking the already-selected day always closes the popover without clearing the value, in every mount — `clearable` governs only whether the popover's own Clear button renders; the explicit Clear button is the sole clearing path. Mounted at `gantt-v2/SolvroGantt.tsx`'s baseline as-of dialog (boxed variant, not clearable — a required field defaulted to today) and `pages/views/ProjectList.tsx`'s due-date cell (bare variant, `triggerLabel` set to the row's local-format `fmt` so the resting cell matches the mobile card byte-for-byte) — zero native `<input type="date">` sites remain anywhere in `frontend/src` (only `DateField.tsx`'s own docstring mentions the string).
- **`DateRangeField` (between-style range picker, user add-on 2026-07-28, ReUI date-field swap plan Task 3.5)**: `frontend/src/components/DateRangeField.tsx` is a two-month range calendar (`ui/calendar.tsx` `mode="range"` inside `ui/popover.tsx`, `positionerClassName="z-101"`, `shadow-overlay!`) for paired START/DUE editing — one Apply/Cancel/Clear interaction replacing two separate `DateField`s. Contract is a PAIR of day strings (`start`/`end`, `string | null` each) — the pair itself is the source of truth, not react-day-picker's `DateRange` object, so an untouched Apply reproduces a due-only or start-only task byte-identically. `frontend/src/lib/dateField.ts` helper inventory: `dayFromIso`/`isoFromDay`/`dayToDate`/`dateToDay`/`formatDisplay`/`commitDraft`/`rangeFromPair`/`pairFromRange`/`normalizePair`/`nextDraftFromSelection` (`rangeFromPair`/`pairFromRange` translate the pair to/from RDP's shape only at the `Calendar`'s `selected`/`onSelect` boundary; `nextDraftFromSelection` ignores RDP's re-click-to-deselect signal; `normalizePair` swaps an inverted pair at Apply time only when the user actually changed something) — 78-test Vitest suite in `dateField.test.ts`. Mounted via `InlineDateRangeEditor.tsx` (now a thin wrapper — a positioning `<span>` plus a `defaultOpen` `DateRangeField` plus per-endpoint `commitDraft`, no state or DOM listeners of its own) in `TaskPanel.tsx`'s DATES editor and the Gantt tree (`gantt-v2/TreeCells.tsx`); and `TaskFormModal.tsx`'s merged "Dates" `FieldRow` (bare variant, one row instead of separate Start/Due rows). **Ratified trade-off (user, 2026-07-28):** interactively creating a fresh start-only or due-only date is gone — a first calendar click into an empty selection always produces a same-day range — in exchange for the simpler between-style UI; existing one-sided data survives an untouched Apply, and Clear still resets both sides together.
- **Theme provider**: `frontend/src/lib/theme.tsx` (light/dark mode, persisted preference). Read/write theme through this provider — don't poke `document.documentElement.classList` directly.
- **Gantt**: the hand-rolled engine (`frontend/src/components/gantt/`) was replaced by ReUI's vendored engine at `frontend/src/components/reui/gantt/` (9 files, 3 `// SOLVRO PATCH` sites, inline-SVG icon replacements) plus a Solvro layer at `frontend/src/components/gantt-v2/` (`SolvroGantt` container, `SolvroBar`, `GanttOverlay`, `connector-paths`, `adapter`, `TreeCells`) mounted at `/projects/:id/gantt`. `frontend/src/lib/gantt/` is retained as the export/data layer (geometry, palette, `exportExcel.ts`/`exportPdf.ts`, exportContext, constants) — `exceljs`, `jspdf`, `jspdf-autotable` stay behind dynamic `import()`. Zoom pills map to labeled granularity: Day→week, Week→month, Month→quarter, Quarter→year. PDF export was redesigned to match the ReUI visual language (baseline ghosts deliberately excluded from PDF); Excel export is untouched. See the Guardrail above — `gantt-task-react` still must never be installed regardless of engine.
- **Kanban**: the hand-rolled board (formerly `ProjectKanban.tsx`, 1,182 lines of dnd-kit orchestration + collision-detection logic) was replaced by ReUI's vendored engine at `frontend/src/components/reui/kanban.tsx` (single file, 947 lines, 0 `// SOLVRO PATCH` sites) plus a Solvro layer at `frontend/src/components/kanban-v2/` (`SolvroKanban` container, `cards.tsx`, `MobileMoveSheet.tsx`, plus dnd-free `adapter.ts`/`commitMapper.ts` pure modules under a 36-case Vitest suite) mounted at `/projects/:id/kanban` through the thin `frontend/src/pages/views/ProjectKanban.tsx` wrapper (`useProjectContext()` → `<SolvroKanban project={...}/>`, mirrors the `ProjectGantt`→`SolvroGantt` precedent). Board-level subtask drag is retired for good — the inline checklist keeps its toggle-only affordance; subtask reordering now lives in per-row up/down controls in both `TaskPanel.tsx` and `TaskFormModal.tsx` (`canEdit`-gated).
- **Mobile responsiveness**: usable down to 375px, desktop-first with desktop-only chrome gated behind `md:` (768px). Sidebar collapses to backdrop-drawer below `md:`; `RightSidebar` overlays full-screen on phone; `Modal.tsx` goes edge-to-edge on phone — every modal inherits this. Gantt is desktop-only (`hidden md:block`); `<ProjectList />` is the mobile fallback. Don't introduce a separate mobile component tree — use the `md:` gate pattern.
- **Global search (⌘K command palette)**: `frontend/src/components/CommandPalette.tsx` is a hand-rolled Modal-convention overlay (same backdrop/shell classes as `Modal.tsx`) composing a third vendored ReUI component, `frontend/src/components/reui/autocomplete.tsx` (Base-UI-backed, 5 `// SOLVRO PATCH` sites — hand-vendored from the registry JSON rather than the shadcn CLI, whose `scroll-area` fallback pulls `radix-ui`), in `inline`+`open` mode (no anchored popup stack). It queries `GET /search` via the `useSearch` hook + `queryKeys.search` (`frontend/src/lib/queries.ts`) for grouped projects/tasks/customers, and lists permission-gated page destinations from `frontend/src/lib/navCommands.ts` (`NAV_COMMANDS`) — the single shared catalogue `Sidebar.tsx` also renders from (its old local `NAV_ITEMS` is gone). Opened via `Shell.tsx`'s app-wide ⌘K/Ctrl+K listener (skips editable targets) or the `TopBar.tsx` search box, which is a live trigger (not decorative) with a mobile-only icon variant.

### Design system

Design name: **"Technical Precision"** — dark-first, charcoal surfaces (`#232321`), Elitery Green primary (`#3aae51`). Full token tables and behavioral rules live in `DESIGN.md` (tracked in git, regenerated from `docs/plans/paper-extraction/` + the theme code, docs-keeper-owned) — read it directly rather than relying on values inlined here. Mockup reference folder is `New UI/` (Figma file + preview HTMLs, gitignored — local-only, not a build target); `UI Design/` no longer exists.

### Features not yet built

#### Secure Ingestion Port (Blueprint → Tasks) — not yet built

**Route**: `POST /webhook/blueprint`. SA-to-TAM handoff that differentiates Solvro from a generic PM tool. Priority feature.

Requirements:
- API key auth only — bypasses `requireAuth`, must not accept user JWTs (see Guardrails)
- Creates `Blueprint` + child `Task` rows in a single transaction
- Preserves `projectId ↔ blueprint` linkage so the AI Breakdown amber glow attaches correctly to generated tasks
- Blueprint-generated tasks flagged via a `blueprintId` foreign key on `Task` so the UI can distinguish them from manually created tasks

#### Other deferred/not-built items (still true)

- **Network Diagram tab**: never built, do not implement. Decision reconfirmed 2026-07-21 — the `@xyflow/react` dependency is being removed from `frontend/package.json` as dead weight; `TaskDependency.sourceHandle`/`targetHandle` remain in the schema but are unused by any shipped UI.
- **Critical path highlighting**: deferred.
- **shadcn / ReUI component stack — SHIPPED 2026-07-25** (no longer deferred): declined 2026-07-22 → decision reversed 2026-07-24 → executed 2026-07-25 (Plan A + Plan B, branch `feat/tailwind-v4-shadcn`). Current state (Tailwind v4 CSS-first theme, shadcn/Base-UI primitives, ReUI Gantt engine at full parity) is documented under Frontend conventions above, not here. Spec: `docs/superpowers/specs/2026-07-24-reui-gantt-swap-design.md`; history: `docs/ideas/gantt-bar-reskin.md`.
- **Native AI summarisation inside Solvro**: deferred indefinitely — the export packet is designed for external AI tools.
- **`WorkLogs.tsx`**: placeholder for iTop API integration (ITSM/utilization), not a manual time-entry screen. Do not wire it up until the iTop API spec is defined. Consider renaming to Utilization when implementation begins.

### Source of truth files

| File | Purpose |
|---|---|
| `CLAUDE.md` (this file) | Agent contract — guardrails, current-state facts, ops commands |
| `CONFIGURATION.md` | Operator's environment & deployment reference (env vars, ports, volumes, prod flow) — docs-keeper-owned |
| `DESIGN.md` | Design system — local-only (gitignored), regenerated, docs-keeper-owned; frontmatter is canonical |
| `CHANGELOG.md` | Running record of what exists and configuration decisions |
| `ISSUES.md` | Known issues, doc/reality drift, deferred findings — local-only (gitignored), docs-keeper-owned |
| `docs/ideas/` → `docs/plans/` → `docs/prompts/` | Planning pipeline, unchanged |
| `docs/archive/` | Historical docs superseded by the files above (`PRD.md`, `tasks/`) |

---

## Ops

Day-to-day commands. For environment variables, ports, volumes, and the prod deployment flow, see **CONFIGURATION.md** — not duplicated here.

### Common commands

```bash
# First time
cp .env.example .env
docker compose up -d --build              # build + start all tiers

# Subsequent
docker compose up -d                      # start (no rebuild)
docker compose logs -f backend            # tail one service
docker compose ps                         # health overview
docker compose down                       # stop, keep postgres volume
docker compose down -v                    # stop + wipe postgres (DESTRUCTIVE)
```

Open `http://localhost:5173` (app), `http://localhost:3000/health` (API), `localhost:5432` (Postgres from host).

### In-container commands

```bash
# Install dependencies (both steps required — container volume ≠ host bind mount)
docker compose exec backend  npm i <pkg>
docker compose exec frontend npm i <pkg>
docker compose restart backend            # required after native bindings or prisma generate

# Prisma
docker compose exec -it backend npx prisma migrate dev --name <slug>   # -it required (interactive)
docker compose exec    backend npx prisma generate
docker compose exec    backend npm run db:seed
docker compose exec    backend npm run prisma:studio                    # GUI at :5555

# Type-check
docker compose exec backend  npx tsc --noEmit
docker compose exec frontend npm run typecheck

# Tests
docker compose exec backend npm test                                    # vitest
cd e2e && npm test                                                       # playwright (desktop + mobile)

# One-off admin provisioning
docker compose exec -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... \
  backend npx tsx scripts/create-admin.ts
```

### Migration gotcha

`prisma migrate dev` is interactive — it hangs in non-TTY shells. Always pass `--name <slug>` and use `-it`:

```bash
docker compose exec -it backend npx prisma migrate dev --name <slug>
```

Non-interactive alternative:
```bash
cd backend && npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/migration.sql
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_<slug>
mv /tmp/migration.sql prisma/migrations/<the-folder>/migration.sql
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma generate
```

### Node modules sync

Dev `node_modules` lives in a Docker named volume, not the host bind mount. `npm install` on the host does not propagate into the container. Always run `docker compose exec <service> npm install` after touching `package.json`, then `docker compose restart <service>` if the dep ships native code or Prisma client. Host-side `node_modules` is still maintained for IDE typechecking — the two trees can drift if you forget to sync.

Environment & deployment reference: **CONFIGURATION.md**.

---

## Agent Roster

The orchestrator is the interactive session itself (no agent file) — it plans with the user (`docs/ideas` → `docs/plans` → `docs/prompts`), dispatches plan tasks, sequences the gates below, performs final acceptance, stages changes, and drafts commit messages. It never commits without explicit user approval.

Four local agents live in `.claude/agents/` — **local-only, never pushed** (`.claude/` is gitignored):

| Agent | Role |
|---|---|
| `solvro-implementor` | Executes one plan task: code + tests + CHANGELOG entry in the same change set. Never self-certifies, commits, or edits CLAUDE.md. |
| `solvro-qa` | Mechanical gate runner: typecheck, vitest, CHANGELOG check, Playwright smoke on frontend-touching tasks. Pass/fail with raw evidence, no fixes. |
| `solvro-reviewer` | Merged code + design review; the design-system lens activates automatically when the diff touches `frontend/`. Reads DESIGN.md/CLAUDE.md at runtime rather than carrying inline copies. Severity-ranked findings, no fixes. |
| `solvro-docs-keeper` | Runs after review: verifies the CHANGELOG entry, syncs this file's Facts block (not Guardrails), syncs DESIGN.md token tables and CONFIGURATION.md when the diff touches their trigger files, files deferred findings into ISSUES.md and prunes entries the shipped work resolved, and syncs stale product facts (paths, commands, trigger lists) embedded in `.claude/agents/*.md` — facts only, never role guardrails, models, or tool lists. |

Model pins (2026-07-25, user decision): `solvro-implementor`, `solvro-qa`, and `solvro-docs-keeper` run `claude-sonnet-5`; `solvro-reviewer` runs `claude-opus-5`. The orchestrator is whatever model the main session is started with — flexible by design. Sonnet is the floor for every subagent; never assign haiku.

Per-task flow: implementor → qa → reviewer → docs-keeper → orchestrator acceptance against plan criteria → user-approved commit. Trivial (typo-level) tasks may skip the reviewer at the orchestrator's discretion; QA and docs-keeper always run.

Full design rationale: `docs/plans/claude-agent-architecture-design.md`.
