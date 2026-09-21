# Implementation Plan: ReUI Data Grid — Phase 3 of the Component Migration

**Branch:** `feat/reui-data-grid` — cut from `origin/develop` @ `3852f4c` (2026-08-01, contains Phases 1+2)
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit/PR without explicit user approval.
**Program docs:** `docs/ideas/reui-component-migration.md` · roadmap in `docs/plans/reui-component-migration.md`. Phase 2 shipped as PR #125.

**Gate 1: APPROVED by the user 2026-08-01** — `@tanstack/react-table`, `@tanstack/react-virtual`, `@dnd-kit/modifiers` are installed (container-written lock, `npm ci` verified) and the Guardrails sanction line is updated. ProjectList: user ruled no evaluation — it stays as-is; DataGrid goes to the four flat tables only.

## Overview

Vendor the ReUI `data-grid` family plus `badge` and the three missing `ui/` primitives, then migrate four tables: `Tasks.tsx` (hidden-route pilot) → `Customers.tsx` → `Admin.tsx` → `CustomerDetail.tsx`. The pilot merges review-clean before any visible page starts.

Verified at planning time (2026-08-01, registry re-read — no drift from 07-30):

- `data-grid` runtime deps: `@base-ui/react` + 4×dnd-kit + 2×TanStack — **all installed**. Expected `package.json` diff during vendoring: **none** (the dep commit precedes the vendor task).
- registryDependencies present in `ui/`: button, checkbox, dropdown-menu, input, popover, separator. **Missing: `select`, `skeleton`, `spinner`** + `@reui/badge` + `@reui/data-grid-table` (ships as part of the data-grid item, multi-file: `data-grid.tsx`, `data-grid-table.tsx`, `data-grid-scroll-area.tsx` + column/pagination/dnd modules per the registry payload).
- **`select` is the hard vendor piece:** the canonical shadcn version is Radix-based (guardrail-banned) and ReUI's re-export is license-gated (Phase 2 precedent). Hand-author on `@base-ui/react`'s Select, scoped to the export surface data-grid actually consumes (pagination page-size selector; check the payload for exact imports). Same pattern as `ui/separator.tsx`.
- `skeleton`/`spinner`: expected plain-React from the shadcn registry (verify radix-free on fetch).
- `badge` (ReUI, Base-UI+cva): its variants consume `--success`/`--info`/`--warning`/`--invert` — already defined since Phase 1. Vendored now as a data-grid dependency; the StatusChip-rebase decision stays in Phase 4.
- **Vendor method: manual only.** The CLI is banned for this repo's vendoring (CLAUDE.md trap: interactive prompts + radix dependency chain). Fetch `reui.io/r/{name}.json` / `ui.shadcn.com/r/styles/new-york-v4/{name}.json`, write `files[].content` by hand, provenance headers per Phase 2 format.
- **Lockfile trap is live:** any lock-writing npm command runs in the container only (root CLAUDE.md Traps, 2026-08-01).

## Architecture Decisions

- **Grids never fetch.** Data comes from the existing `lib/queries.ts` hooks; the grid gets rows + a TanStack instance built in the page component. `queries.ts` is spine — read-only for this phase.
- **Feature floor per table:** sorting via `DataGridColumnHeader`, sticky header, `DataGridContainer`/`DataGridScrollArea` for overflow, loading skeletons wired to the hooks' `isLoading`, empty state via `emptyMessage` (reuse `EmptyState` content conventions). Column visibility/pinning/drag/virtualization OFF at migration (density-first, smallest diff); they can be enabled per-table later.
- **Pagination:** pilot decides. `Tasks.tsx` renders up to the backend's 200-row window — the pilot implementor proposes pagination on/off with evidence (density + scroll feel); the other three tables follow the pilot's verdict unless their data shape argues otherwise (Admin's user list is small).
- **Row interactions preserved exactly:** Tasks row-click opens `TaskFormModal`; other tables keep their links/actions as column cells. React-18 note: any `render`-slot/ref usage must respect the forwardRef state of our primitives (Phase 2 lesson — registry code targets React 19).
- **Known upstream hazards to audit at vendor time:** shadows (DESIGN.md §4 — strip outside overlays), bare `border` without color (popup fix precedent), `ring-[3px]` focus styles (normalize to the canonical 2px string per DESIGN.md §4), `--radius`-style undefined custom properties, garbled registry class fragments (frame precedent), React-19 `ref`-as-prop patterns (forwardRef-wrap what data-grid consumes by ref).
- **Out of scope:** `ProjectList.tsx` (user ruling), `kanban-v2/`, `gantt-v2/`, `queries.ts`, backend, StatusChip/PriorityBadge/LabelChip rebase (Phase 4), row/column drag features, virtualization/infinite scroll (available but unwired).

## Task List

### Wave 1

#### Task 1: Vendor the data-grid family + badge + three primitives

**Description:** Manually vendor: `frontend/src/components/reui/data-grid*.{tsx}` (all files of the registry item, flat under `reui/` or a `reui/data-grid/` dir if the payload is multi-file — mirror the payload's internal import paths), `reui/badge.tsx`, `ui/skeleton.tsx`, `ui/spinner.tsx` (shadcn registry, verify radix-free), and hand-authored `ui/select.tsx` on `@base-ui/react`'s Select exposing exactly the surface data-grid imports. Apply the standard audits: radix grep, shadow strip, focus-ring normalization, bare-border check, provenance headers, `// SOLVRO PATCH` markers, React-18 forwardRef where consumed by ref. No consumers.

**Acceptance criteria:**
- [ ] `grep -ri radix` empty across all new files; `git diff` empty on `package.json`/`package-lock.json`/`components.json` and all pre-existing `ui/` files
- [ ] No live `shadow-*` outside overlay contexts, no `ring-[3px]`, no bare `border` without a color class in the new files
- [ ] Typecheck + `npx vite build` green
**Verification:** scoped checks; **instant opus review (spine: `reui/`)**; gates at integration.
**Size:** L

### Checkpoint A
- [ ] Instant review clear; gates green

### Wave 2

#### Task 2: Tasks.tsx pilot on DataGrid

**Description:** Replace the hand-rolled `<table>` in `frontend/src/pages/Tasks.tsx` with the vendored DataGrid: TanStack columns for ID, title, project link, labels, priority, assignee, due, status (reusing the existing cell components — `PriorityBadge`, `AssigneeAvatar`, `LabelChip`, `TaskStatusChip`, the project `<Link>`); `DataGridColumnHeader` sorting replacing the `sortKey` header logic (same default: due ascending); row click → `TaskFormModal` via `onRowClick` (project-link cell keeps `stopPropagation`); the chips toolbar, checkboxes, and Reset untouched. `isLoading` → skeleton mode; empty state message preserved. Propose the pagination verdict with evidence. 375px: grid inside `DataGridScrollArea`, page body never scrolls horizontally.

**Acceptance criteria:**
- [ ] Filtering (chips + checkboxes), sorting, and row-click behave identically; e2e `kanban-dnd` modal-path specs still pass (`taskRowByProject` targets `<tr>` + project href — verify the grid renders real `<tr>`s or update the helper in the same task)
- [ ] Loading skeleton + empty state render; 375px clean; typecheck + vite build green
**Verification:** scoped checks + targeted e2e run (`kanban-dnd` modal trio) + screenshots both themes/widths. Instant review (design lens) before Wave 3.
**Size:** L

### Checkpoint B — pilot verdict
- [ ] Pilot review clear; gates green
- **Pilot decisions (recorded 2026-08-01, amended at verify; binding for Wave 3):**
  **(1) Pagination OFF** — the full sorted row model renders; the page scrolls vertically and the grid scrolls horizontally inside `DataGridScrollArea`. `pagination.pageSize` is set only to size skeleton rows.
  **(2) Container hairline via wrapper** — `DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest"` (the component's own `border` prop is accepted-and-ignored). Header surface pinned via `tableClassNames.header="bg-surface-container-low"`; the `headerBackground` boolean resolves to `bg-muted` → `surface-container`, the wrong token. **Do not add a text colour here** — every `<th>` declares `text-foreground`, so a `thead`-level colour is inert.
  **(3) Column labels** on `font-display text-label-caps font-bold uppercase`, applied to **both** header paths in `data-grid-column-header.tsx` (spine). No `!`, no `tracking-widest`: the root cause is fixed once in `frontend/src/lib/utils.ts`, which registers the six named `@theme` typography roles via `extendTailwindMerge` so they classify as font-size instead of falling through to tailwind-merge's catch-all colour validator. `font-bold` is still required on both paths — Tailwind v4 threads named-size weight through `--tw-font-weight`, which `font-medium` sets on both `ui/button.tsx`'s base and the `<th>`, and which inherits. Regression-guarded by `frontend/src/lib/utils.test.ts`.
  **(4) Virtualization off** → `estimateSize` n/a.
  **(5) `tableLayout.dense` ON**; `meta.skeleton` per column is required for non-blank loading rows.
  **(6) Column sizing: `tableLayout.width="auto"`.** `"fixed"` gives every column TanStack's default 150px basis, killing content-proportional layout and pinning the table to viewport width so it crushes instead of scrolling at 375px.
  **(7) String columns must declare an explicit `sortingFn`.** TanStack's auto-detection reads `flatRows.slice(10)` — from index 10 onward, not the first ten — so any table with ≤10 rows falls through to `basic` (raw codepoint compare). Admin's user list is exactly that case. Tasks uses `"alphanumeric"`, a deliberate change from `localeCompare`: natural number ordering, at the cost of accents sorting after `z` — for person/company name columns where accents are plausible, prefer a `localeCompare`-based custom fn and record the choice.

### Wave 3 — parallel (disjoint files)

#### Task 3: Customers.tsx · Task 4: Admin.tsx · Task 5: CustomerDetail.tsx

**Description (Tasks 4/5):** Same migration pattern as the pilot, following its recorded decisions. Keep each page's row links/actions as cells; keep surrounding chrome (headers, create buttons, tabs) untouched. `CustomerDetail.tsx` migrates only its task/project table(s), not the tabs or notes surfaces.

**Task 3 RESCOPED (user decision, 2026-08-01):** `Customers.tsx` never had a table — it is a card grid, and the roadmap's "four tables" premise was wrong about it. The user ruled: keep the card design, move `CustomerCard`'s shell onto the Phase-1-vendored `Frame` (ReUI's free card-surface primitive; ReUI's "Card" items are Pro-gated blocks). Presentation-only, visual parity is the acceptance bar, no DataGrid on this page.

**Acceptance criteria (each):** behavior parity, 375px clean, scoped checks green, screenshots.
**Size:** S–M each

### Phase close
- [ ] Phase review on the combined diff → fix rounds → verify
- [ ] CHANGELOG appends (incl. the dependency addition entry); docs-keeper (deferred findings; DESIGN.md only if styling rules changed)
- [ ] `TaskStop` agents; stage; draft commits + PR body → **STOP for user approval**

## Risks

- **`ui/select.tsx` hand-author:** Base UI's Select anatomy differs from Radix's — the data-grid's pagination consumption is narrow, keep the surface minimal; anything structural → stop-and-report.
- **e2e coupling:** `taskRowByProject` (kanban-dnd) and any spec touching table markup may break if the grid changes row DOM; the grid emits `data-row-id` on real `<tr>`s per the API docs — verify early in the pilot.
- **Density:** grid defaults (`h-9` controls, cell padding) vs Technical Precision — `dense` layout flag exists; pilot calibrates.
- **Multi-file vendor size:** the data-grid item is the largest vendor yet; the instant review is correspondingly heavier — budget for a real fix round.
