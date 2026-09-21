# Implementation Plan: ReUI Filters — Phase 2 of the Component Migration

**Branch:** `feat/reui-filters` — cut from `origin/develop` @ `2857662` (2026-07-31, contains Phase 1)
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit/PR without explicit user approval.
**Program docs:** `docs/ideas/reui-component-migration.md` · `docs/plans/reui-component-migration.md` (roadmap; this is Phase 2). Phase 1 shipped as PR #123.

## Overview

Vendor `@reui/filters` plus the four `ui/` primitives its registry pulls that Solvro lacks (`button-group`, `input`, `input-group`, `kbd`), then wire two consumers: the `Tasks.tsx` toolbar (four `FilterSelect` dropdowns → the Filters chip system) and `Projects.tsx`'s customer filter (must keep its `?customerId=` URL contract). Zero new npm dependencies.

Verified at planning time (2026-07-31):

- `filters` runtime deps: `@base-ui/react`, `class-variance-authority` — both installed. Expected `package.json` diff: **none, byte-identical**.
- `filters` registryDependencies: `button`, `button-group`, `dropdown-menu`, `input`, `input-group`, `kbd`, `scroll-area`, `tooltip`. Four exist in `ui/` as Solvro Base-UI files (`button`, `dropdown-menu`, `scroll-area`, `tooltip`) — the CLI **must not overwrite them**; four are new (`button-group`, `input`, `input-group`, `kbd`).
- `Tasks.tsx` filter state: local `useState<TasksFilter>` (`:27`) feeding `useTasks(filter)`; the four dropdowns (status, priority, assignee, customer) use a file-local `FilterSelect` helper (`:293`) — no other file imports it. Two checkbox toggles (overdue, top-level) and a sort select share the toolbar; a Reset button restores `{ topLevel: true }`.
- `TasksFilter` (single-valued fields: `status?`, `priority?`, `assignedToId?`, `customerId?`, `overdue?`, `topLevel?`) lives in `frontend/src/lib/queries.ts:269` — **spine file, out of scope; the shape must not change.**
- `Projects.tsx` customer filter drives `?customerId=` through `useSearchParams` (`:10-26`), self-heals when the customer disappears (`:31-35`), and is deep-linked from elsewhere — the URL contract is behavior, not presentation.
- Filters API (registry, read 2026-07-31): `Filters({filters, fields, onChange, …})`, `FilterFieldConfig` types `"select" | "multiselect" | "text" | "custom"`, `createFilter(field, operator?, values?)`. Single-select fields map 1:1 onto `TasksFilter`'s single-valued fields.

## Architecture Decisions

- **Filters is a UI-state layer only.** Active `Filter[]` state lives in each page component and is *derived down* to the existing shapes: `TasksFilter` for `useTasks`, the `?customerId=` param for Projects. `queries.ts` untouched; no URL schema changes; the server API sees identical requests.
- **Tasks toolbar scope:** the four dropdowns become Filters `select` fields (single value each — `maxSelections`/multiselect NOT used, because `TasksFilter` is single-valued and widening it would touch the spine). The overdue/top-level checkboxes and the sort select stay as-is — they are view toggles, not filter chips. Reset clears the Filters array and restores `{ topLevel: true }`. The local `FilterSelect` helper is deleted once nothing uses it.
- **Projects scope:** one Filters `select` field ("Customer") whose onChange writes through the existing `setCustomerFilter` (URL param). The self-heal effect and the `activeCustomer` header line stay. If the chip-system chrome overwhelms a one-field toolbar, the implementor may propose keeping a slimmer trigger — flag in the report, phase review decides.
- **Vendor rule for existing `ui/` files:** run the CLI, then `git diff` — any change to `button/dropdown-menu/scroll-area/tooltip` is reverted; the four new primitives are audited (no radix, Base-UI/cva only) and themed per `docs/DESIGN.md` if their defaults clash.
- **Out of scope:** `queries.ts`, backend, any other list view, multiselect semantics, saved-filter persistence, the `enableShortcut` keyboard flag (defer — ⌘K palette owns keyboard entry today; note in ISSUES if wanted).

**Decision (user, 2026-07-31 — via review escalation):** form-control styling is unified NOW, onto the app/DESIGN.md style — not the vendored shadcn defaults. DESIGN.md §4's 2px primary outline is binding; the vendored files change to comply. Scope: the five form-control files (`ui/button.tsx`, `checkbox.tsx`, `calendar.tsx`, `input.tsx`, `textarea.tsx`) + `input-group.tsx` — focus rings `ring-[3px] ring-ring/50` → `ring-2 ring-primary/30`, and the pre-existing `shadow-xs` in button/checkbox/calendar is stripped (closes the intra-chip shadow seam the review found). Gantt shadow sites (`reui/gantt/gantt-view.tsx:3695`, `gantt-v2/SolvroBar.tsx:154,165`) stay out — filed to ISSUES; gantt is spine-sensitive and recently patched (#118). This lands as **Task 1b**, owned by the Task 1 implementor. Scope ruling at re-review (orchestrator, 2026-07-31): the deepest-inset surface rule covers **text-entry surfaces only** — `input`, `textarea`, and the `input-group` root; `checkbox`'s unchecked fill keeps its `input/30` tint (a control tint, not a text inset — changing it was never part of the divergence and would restyle an already-shipped control for no stated reason).

## Task List

### Wave 1

#### Task 1: Vendor `reui/filters.tsx` + four `ui/` primitives

**Description:** `npx shadcn@latest add @reui/filters` from `frontend/`. Final paths: `frontend/src/components/reui/filters.tsx` + `frontend/src/components/ui/{button-group,input,input-group,kbd}.tsx`. Revert any CLI change to the four pre-existing `ui/` files (`git checkout -- <file>`) and to `package.json`/`components.json`. Audit all five new files: `grep -ri radix` empty; imports Base-UI/cva/`@/lib/utils`/React (+`lucide-react` allowed in vendored files); `// SOLVRO PATCH` any hand edit. No consumers.

**Acceptance criteria:**
- [ ] Five new files at the exact paths; `grep -ri radix` on them empty
- [ ] `git diff` empty on: `package.json`, `components.json`, `ui/button.tsx`, `ui/dropdown-menu.tsx`, `ui/scroll-area.tsx`, `ui/tooltip.tsx`
- [ ] `docker compose exec frontend npm run typecheck` AND `npx vite build` green

**Verification:** scoped checks; **instant opus review (spine: vendored `reui/`)**; gates at wave integration.
**Files:** `reui/filters.tsx`, `ui/button-group.tsx`, `ui/input.tsx`, `ui/input-group.tsx`, `ui/kbd.tsx`
**Size:** M

### Checkpoint A
- [ ] Task 1 instant review clear; gates green

### Wave 2 — parallel (disjoint files)

#### Task 2: Tasks.tsx toolbar on Filters

**Description:** Replace the four `FilterSelect` dropdowns with one `<Filters>` (fields: Status, Priority, Assignee, Customer — all `type: "select"`, options from the existing hooks' data). Derive `TasksFilter` from the active `Filter[]` (first value per field; absent field → `undefined`) and feed `useTasks` exactly as today. Keep: overdue + top-level checkboxes, sort select, header copy, row list, `TaskFormModal` wiring. Reset button clears the chips AND restores `{ topLevel: true }`. Delete the now-unused `FilterSelect`. Do not touch `queries.ts`.

**Acceptance criteria:**
- [ ] Each of the four filters filters the list identically to before (same `useTasks` argument shapes — assert via react-query devtools or a temporary log, removed before report)
- [ ] Checkboxes, sort, reset, row-click editor unchanged; usable at 375px
- [ ] `FilterSelect` gone; typecheck + vite build green

**Files:** `frontend/src/pages/Tasks.tsx`
**Size:** M

#### Task 3: Projects.tsx customer filter on Filters

**Description:** Replace the customer `<select>` row with a one-field `<Filters>` ("Customer", `type: "select"`, options from `useCustomers`). onChange writes through the existing `setCustomerFilter` so `?customerId=` behavior — deep links, replace-mode history, self-heal effect, `activeCustomer` header, clear affordance — is byte-for-byte. If the full chip chrome reads as too heavy for one field, implement it anyway and flag the concern with a screenshot for phase review.

**Acceptance criteria:**
- [ ] `?customerId=` round-trips: deep link in → chip shown; chip cleared → param removed (replace, not push)
- [ ] Removing the filtered customer from the system still self-heals to unfiltered
- [ ] Usable at 375px; typecheck + vite build green

**Files:** `frontend/src/pages/Projects.tsx`
**Size:** S

### Phase close
- [ ] Phase review (same-reviewer continuation; design lens on the chip toolbar density)
- [ ] CHANGELOG appends (orchestrator, serial); docs-keeper only if a trigger fires (`index.css` untouched this phase unless theming needed — check at close)
- [ ] `TaskStop` all agents; stage, draft 3 commits + PR body → **STOP for user approval**

## Risks

- **Chip-UX vs density:** a four-chip add-filter bar is a different interaction from four always-visible dropdowns; TAM muscle memory changes. Phase review carries the design-lens verdict; screenshots required from both consumer tasks.
- **CLI clobber risk is real this phase** (four name collisions with existing `ui/` files) — Task 1's revert step is load-bearing.
- **Filters' input/kbd primitives may pull their own registry deps** (e.g. `input-group` referencing `separator`) — if the CLI lands extra `ui/` files, stop and report; do not silently accept scope growth.
- **Derivation drift:** the `Filter[]` → `TasksFilter` mapping must produce `undefined` (not `""`/`null`) for absent fields, or query keys change shape and caching splinters.
