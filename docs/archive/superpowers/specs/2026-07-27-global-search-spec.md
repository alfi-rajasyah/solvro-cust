# Spec: Global Search & Command Palette (⌘K)

> Status: **draft — awaiting user approval** · Branch base: `origin/develop` · Date: 2026-07-27
> Phase 1 (Specify) artifact of the spec-driven workflow. Plan and task breakdown follow after approval.

## Objective

The top-bar search box (`frontend/src/components/layout/TopBar.tsx:82–94`) is currently pure decoration: a bare `<input>` with no handlers, a static ⌘K badge with no listener, and no backend search route. This feature makes it real.

Build a **global command palette**: pressing ⌘K / Ctrl+K anywhere in the authed app (or clicking the top-bar search box) opens a centered overlay that searches **projects, tasks, and customers** via a new `GET /search` endpoint, mixes in **permission-gated page-navigation commands**, and jumps to the selected result. For the solo TAM user this makes ⌘K the universal "go to anything" key.

**User decisions locked (2026-07-27):** command-palette modal UX · dedicated `GET /search` endpoint · scope = projects + tasks + customers (Daily Review notes excluded from v1) · nav commands included.

## Tech Stack

Existing only — **zero new npm dependencies**:

- Frontend: React + TypeScript + Vite, TanStack Query, react-router, Tailwind v4 (CSS-first tokens in `frontend/src/index.css`), Base-UI-backed primitives in `frontend/src/components/ui/`.
- Backend: Express + Zod validation + Prisma + PostgreSQL.

**ReUI registry exploration (2026-07-27):**

- **Adopt `@reui/autocomplete`** — vendor via `npx shadcn@latest add @reui/autocomplete` into `frontend/src/components/reui/autocomplete.tsx` (alongside the vendored gantt/kanban). It is Base UI's Autocomplete under the hood (external ref: base-ui.com/react/components/autocomplete), and every dependency is already installed: `@base-ui/react ^1.6.0`, `class-variance-authority ^0.7.1`; its registry dep `scroll-area` is one of our existing `ui/` primitives. Gives us input + listbox keyboard navigation, ARIA combobox semantics, and `AutocompleteEmpty`/group support for free. Composition references (free examples): `c-autocomplete-8` "With groups and labels" (our grouped Projects/Tasks/Customers/Pages shape) and `c-autocomplete-9` "With search results" (async results).
- **Overlay shell stays hand-rolled** per `Modal.tsx` conventions — verified the registry has no command-palette or dialog component among its 20. The Autocomplete mounts *inside* the centered overlay. Risk noted: Base UI's Autocomplete is an anchored-popup pattern; if its positioning fights the fixed centered layout, fall back to composing Base UI primitives directly (already a dependency) with the same list semantics — implementor validates at build time.
- **Optional polish:** `@reui/icon-tile` (same already-installed deps) as result-row media (`xs`/`sm`, `outline` variant) — nice-to-have, not required for v1.
- **Banned:** `cmdk` — transitively depends on `radix-ui` (removed from this repo by decision 2026-07-24; never reintroduce).
- Vendoring rule (CLAUDE.md): re-running the shadcn/ReUI CLI strips vendor headers — mark any hand-edited lines in the vendored file with `// SOLVRO PATCH`.

## Commands

All gates run in containers (per CLAUDE.md Ops):

```bash
docker compose exec backend  npx tsc --noEmit          # backend typecheck
docker compose exec frontend npm run typecheck          # frontend typecheck
# backend tests against isolated test DB (never the live dev DB):
TEST_URL=$(docker compose exec backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') \
  && docker compose exec -e DATABASE_URL="$TEST_URL" backend npm test
docker compose exec frontend npm test                   # frontend vitest (pure modules)
cd e2e && npm test                                      # Playwright (desktop + mobile)
```

## Project Structure (files created / touched)

```
backend/src/routes/search.ts          NEW  GET /search route
backend/src/app.ts                    EDIT mount searchRouter (no /api prefix, like all routers)
backend/test/search.test.ts           NEW  vitest: auth, validation, shape, visibility scoping
frontend/src/components/reui/autocomplete.tsx NEW  vendored ReUI autocomplete (Base-UI-backed)
frontend/src/components/CommandPalette.tsx   NEW  overlay shell composing the autocomplete
frontend/src/lib/navCommands.ts       NEW  pure module: static page list + permission filter
frontend/src/lib/navCommands.test.ts  NEW  vitest for the pure module
frontend/src/lib/queries.ts           EDIT useSearch(q) hook + queryKeys.search(q)
frontend/src/components/layout/TopBar.tsx    EDIT search box becomes palette trigger; mobile search icon
frontend/src/components/layout/Shell.tsx     EDIT mount palette + single global ⌘K/Ctrl+K listener
e2e/tests/search.spec.ts              NEW  Playwright: open, type, navigate
CHANGELOG.md                          EDIT entry under [Unreleased] (same turn as code, mandatory)
```

## API Design — `GET /search?q=<term>`

- `requireAuth` at router top (standard). No new permission — read access mirrors what each entity's own list route already allows.
- Validation: `validate("query", z.object({ q: z.string().trim().min(2).max(100) }))` → 400 below 2 chars.
- Three Prisma queries in one `Promise.all`, each `take: 8`, case-insensitive `contains`, ordered `name`/`title` asc:
  - **projects** — `where: { AND: [projectVisibilityFilter(user), { name: { contains: q, mode: "insensitive" } }] }` → `{ id, name, status, customerName }` (`customerName` nullable — `customerId` is optional).
  - **tasks** — title match, scoped via `project: projectVisibilityFilter(user)` → `{ id, title, status, projectId, projectName }`.
  - **customers** — name match, `requireAuth` only (mirrors existing `GET /customers`) → `{ id, name }`.
- Response: `{ projects: [...], tasks: [...], customers: [...] }`.
- Reuse `projectVisibilityFilter` from `backend/src/lib/visibility.ts` — never re-derive role scoping (CLAUDE.md guardrail). Errors via `HttpError`; shared `prisma` instance.
- Performance: sub-200ms NFR. Plain ILIKE over current data volumes is expected to pass; a `pg_trgm` index migration is **deferred and ask-first** (schema change).

## Frontend Behavior

- **Open:** ⌘K / Ctrl+K (single `keydown` listener registered once in `Shell`, ignoring events from editable targets) or clicking the top-bar search box. The box becomes a read-only trigger styled exactly as today. **Close:** Esc, backdrop click, or selecting a result.
- **Input:** autofocus; 200 ms debounce; `useSearch(q)` enabled at ≥2 chars (`queryKeys.search(q)` — main namespace, not `adminQueryKeys`).
- **Results:** groups in order — Pages · Projects · Tasks · Customers. Empty query shows Pages only. Loading/empty states ("No results for 'x'").
- **Pages group:** static list in `navCommands.ts` mirroring the sidebar (Overview → Projects → Customers → Daily Review → Reports → Executive → Settings → Admin), filtered with `hasPermission` exactly like `Sidebar.tsx:39–40` (Executive needs `report:executive`; Admin needs wildcard).
- **Keyboard:** ↑/↓ moves across groups, Enter opens, Esc closes; ARIA combobox/listbox semantics come from the vendored ReUI autocomplete rather than hand-rolled listeners.
- **Navigation on select:** project → `/projects/:id` · task → `/projects/:projectId/list?task=<id>` (the `task` param is already read by `ProjectDetail.tsx:43` to open the TaskPanel — reuse, don't rebuild) · customer → `/customers/:id` · page → its route.
- **Mobile (<`md`):** the search box is hidden today; add a search icon button in `TopBar` (`md:hidden`) opening the same palette, edge-to-edge per the `Modal.tsx` convention. No separate mobile component tree.
- **Styling:** semantic tokens from the `@theme inline` blocks only — no raw hex; works in light and dark via the theme provider.

## Code Style

Follow the existing optimistic/query patterns in `queries.ts`; new hook looks like its neighbors:

```ts
// frontend/src/lib/queries.ts
export function useSearch(q: string) {
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => apiRequest<SearchResults>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}
```

Conventions that bind here: all HTTP through `apiRequest` (never raw `fetch`); `@/` path alias; camelCase TS over `@map`ped snake_case columns; Zod schemas at the top of the route file.

## Testing Strategy

- **Backend (`backend/test/search.test.ts`, vitest):** 401 without token; 400 for `q` < 2 chars; response shape and 8-per-group cap; **visibility scoping is the load-bearing test** — a TAM sees only their own projects/tasks while a wildcard user sees all. Run against the isolated `solvro_test` DB (see Commands; drop/recreate if it flakes per CLAUDE.md caveat iii).
- **Frontend (`navCommands.test.ts`, vitest node env):** permission filtering — PENDING (empty perms) sees nothing gated, TAM sees no Executive/Admin, ADMIN wildcard sees all.
- **E2E (`e2e/tests/search.spec.ts`, Playwright):** desktop — ⌘K opens palette, typing a seeded project name shows a grouped result, Enter lands on `/projects/:id`; mobile — search icon opens the palette. Esc closes and returns focus.

## Boundaries

- **Always:** branch the implementation off up-to-date `origin/develop`; PR targets `develop`, assigned to `alfi-rajasyah` immediately after opening; CHANGELOG entry in the same turn as any code change; reuse `projectVisibilityFilter`, `apiRequest`, shared `prisma`, `HttpError`, semantic tokens; run all gates before claiming done.
- **Ask first:** any new npm dependency (target is zero); any schema change or migration (incl. `pg_trgm` index); touching `visibility.ts`, `auth.ts`, or `Modal.tsx` beyond consumption; adding search fields beyond name/title (e.g. descriptions).
- **Never:** install `cmdk` or anything radix-backed; search or expose `ProjectNote` content (INTERNAL-note guardrail — notes are out of scope entirely); mount the route under `/api/`; call `fetch` directly; delete/rename `Tasks.tsx`; commit or open a PR without explicit user approval.

## Success Criteria

1. ⌘K and Ctrl+K open the palette on every authed page; Esc/backdrop closes it; the top-bar box and mobile icon open it too.
2. Typing ≥2 chars shows grouped Projects/Tasks/Customers results; `GET /search` responds < 200 ms locally.
3. Selecting: project → project detail; task → List view with its TaskPanel opened via `?task=`; customer → customer detail; page command → its route.
4. A TAM-role user cannot receive projects or tasks outside `projectVisibilityFilter` scope — enforced server-side and proven by a backend test.
5. Nav commands honor permissions (no Executive without `report:executive`, no Admin without wildcard) — proven by the pure-module test.
6. All gates green: both typechecks, backend + frontend vitest, the new e2e spec; CHANGELOG entry present.
7. `git diff` of `package.json` files is empty (no new dependencies).

## Open Questions

1. Empty-query state: v1 shows Pages only — should it later show recent/suggested items (e.g. recently viewed projects)?
2. Ranking: v1 is simple `contains` + alphabetical — promote prefix matches if results feel noisy?

*(Resolved 2026-07-27: spec relocated from repo root to `docs/superpowers/specs/` per local-only planning-docs convention.)*
