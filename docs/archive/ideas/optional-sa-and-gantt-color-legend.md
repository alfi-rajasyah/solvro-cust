# Optional SA + Sustained Gantt Color Legend

Refined from a user bug report (2026-07-23). Two independent UX fixes, one small branch.

## Problem Statement

1. HMW let a project exist without a Solution Architect, given no SAs use Solvro yet?
2. HMW make the Gantt Color-by control always explain what the bar colors mean?

## Context (code findings)

- `Project.saId` is a non-nullable column with a required relation (`backend/prisma/schema.prisma:119`); the create endpoint requires it (`backend/src/routes/projects.ts:42`); the modal blocks submit on it (`frontend/src/components/ProjectFormModal.tsx:116`).
- ~8 renderers dereference `project.sa.username` unconditionally: `ProjectDetail.tsx:100`, `RightSidebar.tsx:136`, `Projects.tsx:123/155/157` (avatar), `CustomerDetail.tsx:354`, `Admin.tsx:1262`, and the customer-facing export line at `frontend/src/lib/export/projectExport.ts:192`.
- The PATCH route only ever *connects* an SA (`projects.ts:298`) — there is no disconnect path today.
- `projectVisibilityFilter` is already null-safe: a null `saId` simply matches no SA.
- `legendEntries("section")` deliberately returns `[]` (`frontend/src/lib/gantt/palette.ts:69`) — the vanishing legend. The legend row is also `hidden lg:flex` (`GanttFrame.tsx:837`), so below 1024px no mode has a legend.
- Section colors are per-project and dynamic; sections without a custom color get a deterministic preset via the slate-sentinel cycling in `geometry.ts`.

## Recommended Direction

**1 — SA optional end-to-end.** Migrate `Project.saId` to nullable (`Int?`, optional relation). Create schema drops the requirement; update schema accepts `saId: null` and maps it to `disconnect`. Modal loses the asterisk and required-check, gains a "No SA" empty option. Frontend types become `sa: {...} | null` (4 spots in `frontend/src/lib/queries.ts`), with "—" fallbacks in ProjectDetail, RightSidebar, CustomerDetail, Admin, and the SA avatar simply not rendered on project cards. The export packet omits the SA line when unset (never print "—" to a customer). `projectVisibilityFilter` needs no change.

**2 — "Color by" dropdown + always-on legend.** Replace the segmented COLOR control in `GanttFrame.tsx` with a labeled **"Color by"** native `<select>` styled to theme tokens (per the no-component-stack guardrail — no vendored combobox). `legendEntries` learns Section mode: it takes the project's sections and returns `[name, resolvedColor]` pairs using the same fallback resolution as `geometry.ts`, capped with "+N more". The legend renders in **all three modes** and loses its `hidden lg:` gating, so it is sustained at every Gantt-capable width. Excel/PDF exports are untouched — `barFillHex` stays the single fill authority.

## Key Assumptions to Validate

- [ ] No backend consumer dereferences `project.sa` non-null outside the Prisma includes — validated by `tsc --noEmit` after the type flip
- [ ] Section legend stays readable on section-heavy projects — verify on a project with 8+ sections, tune the cap
- [ ] A token-styled native select reads as well as the segmented control — solvro-reviewer's design lens confirms against DESIGN.md

## MVP Scope

**In:** schema migration, optional SA through create/update/render/export, PATCH disconnect path, Color-by dropdown, dynamic section legend, legend visible at all widths, CHANGELOG entries.
**Out:** everything under Not Doing.

## Not Doing (and Why)

- **Auto-defaulting SA to creator** — fake data, and wrongly grants SA-scoped visibility
- **Removing the SA field from the modal** — wanted the day SAs onboard; optional is strictly better
- **Click-to-filter legend chips** — legend is explanatory; filtering is scope creep
- **Touching export color logic** — already unified via `barFillHex`

## Open Questions

- None blocking — PATCH-clears-SA and export-omits-SA are decided above; flag in review if either feels wrong.
