# ReUI Component Migration (program) — COMPLETE 2026-08-01

**Outcome:** all four phases shipped or resolved (roadmap doc carries the close-out). Gate 1 approved (3 deps); Gate 2 resolved keep-bespoke (Standing decision). This file is retained as the decision record; move to `docs/archive/` with the roadmap when convenient.

## Problem Statement
How might we compose most of Solvro's UI from vendored ReUI components — one consistent, maintained component vocabulary — instead of hand-rolled one-offs, without breaking the Base-UI guardrail or the Technical Precision design system?

## Current State (verified 2026-07-30)
- Vendored already: `reui/gantt/`, `reui/kanban.tsx`, `reui/autocomplete.tsx`, `reui/sortable.tsx` (merged to `develop` via PR #115, 2026-07-31).
- `ui/` primitives (Base-UI): button, calendar, checkbox, context-menu, dropdown-menu, popover, scroll-area, tooltip — 8 files.
- ReUI free catalog: 20 components. 4 done → 16 candidates.
- ReUI's current "base" line is Base-UI native — `@base-ui/react` appears in every dep list checked (data-grid, filters, timeline). The Radix-era Slot patching (kanban) is no longer the norm, but every pull still gets a `grep -ri radix` audit.

## Recommended Direction
Extend the vendoring pattern from drag engines to the whole free catalog **where a Solvro surface exists**. Vendor via `npx shadcn@latest add @reui/<name>` from `frontend/`, audit the diff, mark hand edits `// SOLVRO PATCH`, theme through the shadcn semantic bridge `@theme inline` block in `src/index.css`. Never npm-install a component package.

### Component → surface map

**Adopt (a surface exists today):**

| ReUI | Solvro surface | Notes |
|---|---|---|
| `data-grid` | tables in `Tasks.tsx`, `Customers.tsx`, `CustomerDetail.tsx`, `Admin.tsx` | Flagship win: sorting, column visibility, sticky header, pagination for free. **Dep gate** — see Decision Gates. `Tasks.tsx` (hidden route) is the zero-blast-radius pilot. |
| `filters` | toolbar filtering on `Tasks.tsx`, `Projects.tsx` list views | Deps `@base-ui/react` + `cva` only — zero new npm deps. Registry pulls new primitives (button-group, input, input-group, kbd). |
| `timeline` | `pages/views/ProjectTimeline.tsx` restyle | Dep: `@base-ui/react` only, no registry deps. Migrate in place — the tab itself is guardrail-protected. |
| `alert` | form-error callouts (`Login.tsx` + the 4 form modals first; 26 sites total) | `InstallBanner.tsx` excluded (decision 2026-07-31) — slim tap-target, not a callout. Needs new `--success`/`--info`/`--warning`/`--invert` tokens in `index.css`. |
| `frame` | card surfaces; evaluate `Overview.tsx` / `Executive.tsx` stat cards | Adopt only where it beats the existing card markup. |
| `icon-tile`, `icon-stack` | `EmptyState.tsx` rebuild | Icon children stay `material-symbols-outlined` — icon-tile wraps arbitrary children. |
| `badge` | underlay for `StatusChip` / `PriorityBadge` / `LabelChip` | **Decision gate**: rebase vs keep bespoke. External visual API must not change — AI Breakdown amber glow etc. is DESIGN.md-bound. |

**Defer (no surface yet):** `stepper` (waits for Secure Ingestion Port onboarding UI), `event-calendar` (DailyReview is a notes flow, not a calendar — revisit only if a calendar surface is ever specced).

**Not doing:** see below.

## Key Assumptions to Validate
- [ ] The shadcn semantic bridge block in `index.css` covers the tokens data-grid/filters consume — spot-check against `docs/DESIGN.md` in Phase 1.
- [ ] CLI pulls respect `components.json` aliases and do not clobber the 8 existing Base-UI `ui/` files — dry-run on a scratch branch before the first phase.
- [ ] `filters` state maps onto the existing per-view filter state without URL or schema changes.
- [ ] data-grid is usable at 375px, or each migrated table gets an explicit `md:` fallback per frontend/CLAUDE.md mobile rules.

## Decision Gates (user — before the relevant phase)
1. **data-grid deps** (verified 2026-07-30): `@tanstack/react-table`, `@tanstack/react-virtual`, `@dnd-kit/modifiers`. The first two are headless logic libs outside the drag-lib ban; `@dnd-kit/modifiers` extends the sanctioned dnd-kit list, which is Guardrails wording — a user-owned edit. Approve or drop before Phase 3.
2. **Chip rebase**: move `StatusChip`/`PriorityBadge`/`LabelChip` onto `reui/badge` internals, or keep them bespoke and use `badge` only for new surfaces.

## MVP Scope (program)
In: presentation set (frame, icon-tile, icon-stack, alert, timeline) → filters → data-grid on the four table pages → badge decision.
Out: everything under Not Doing; no rewrite of screens that already run on vendored engines.

## Not Doing (and Why)
- **`date-selector`** — `DateField`/`DateRangeField`/`lib/dateField.ts` are spine and carry the plain-calendar-day contract that already caused an off-by-one walk-back east of UTC. Highest risk, lowest gain in the catalog.
- **`tree`** — ProjectList grouping, kanban-v2, and gantt-v2 already cover hierarchy views.
- **`number-field`, `phone-input`, `rating`, `scrollspy`** — no Solvro surface.
- **Engine rewrites** — `kanban-v2/`, `gantt-v2/`, ProjectList task-drag stay untouched; they are working, spine-reviewed drag systems.

## Notes
- `reui/` is on the spine list — every vendor task gets an instant opus review.
- `lucide-react` stays inside vendored files only; app chrome keeps `material-symbols-outlined`.
- `Tasks.tsx` and the Timeline tab migrate in place; deletion is guardrail-banned.
- Catalog + APIs read via the ReUI MCP registry (`list_components`, `get_component`) on 2026-07-30; re-verify dep lists at each phase start — the registry moves.
