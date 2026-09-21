# Gantt Bar Re-skin (paint-only)

Refined 2026-07-22 from "Gantt bar colors are stale" + an evaluation of
adopting ReUI's Gantt component. Companion implementation plan:
`docs/plans/gantt-bar-reskin-plan.md`. Visual spec: 1:1 before/after mockup
artifact (replicates `/projects/:id/gantt` with working Color-by toggle,
light + dark): https://claude.ai/code/artifact/818ee192-dd6f-4e31-9391-9e8e5d99ef24

## Problem

How might we make Gantt bars communicate status / section / priority at a
glance instead of rendering as washed-out ghosts?

## Diagnosis

`frontend/src/lib/gantt/palette.ts:31` — `BAR_TRACK_OPACITY = 0.28`. A bar
renders as a 28%-opacity "track" of its color; only the progress fill is
solid. Real projects sit mostly at 0% progress with no section colors
assigned (the `Section.color` schema default is neutral slate `#94a3b8`), so
every bar is a uniform gray-lavender ghost regardless of Color-by mode.
Notably, the Excel/PDF exports already render **solid** fills via
`barFillHex` — the on-screen chart is the only ghost surface.

## Evaluated and rejected: ReUI Gantt swap

- ReUI's Gantt (reui.io) has no dependency lines, no baselines, no milestone
  markers, and no export in its documented API — four features the
  hand-rolled engine already ships.
- The frontend has no shadcn stack (no `components.json`, no Base UI/Radix,
  no `cva`/`tailwind-merge`/`date-fns`); bootstrapping it is a mini-project
  and conflicts with the repo's dependency-lean direction.
- **Decision 2026-07-22: skip shadcn entirely.** ReUI serves as a visual
  reference only. Standing policy: if a future feature needs a genuinely
  hard interactive primitive (combobox, command palette, date-range picker),
  vendor that single component's source and restyle it to Technical
  Precision tokens — never adopt the stack wholesale.
- Backend/DB impact of any of this: none. shadcn (and this re-skin) are
  purely frontend concerns.

## Recommended direction

Re-skin the hand-rolled Gantt with ReUI's visual language — engine,
geometry, and data model untouched:

1. **Solid vivid fills** — bars always render solid in their mode color;
   progress becomes a darker overlay on top instead of being the only solid
   part.
2. **Task labels on bars** — name inside the bar when it fits, floated
   beside it otherwise.
3. **Section summary bars** — slim rollup bar on section header rows
   spanning the children's date range (section rows already carry a
   computed `start`/`end` in `geometry.ts`).
4. **Richer section palette** — vivid dark+light-safe presets, plus a
   deterministic vivid fallback for sections still on the legacy slate
   default, so Section mode differentiates with zero user action.

Touched files: `lib/gantt/palette.ts`, `lib/gantt/geometry.ts`,
`components/gantt/GanttBar.tsx`, `components/gantt/GanttSectionBar.tsx`
(+ chart-pane wiring). Exports inherit the new hexes automatically.

## Assumptions to validate

- [ ] The vivid palette reads on both themes — verify with the mockup's
      theme toggle and a dark/light QA sweep after implementation
- [x] Bar labels don't clutter dense charts — inside/outside threshold +
      truncation; revisit after dogfooding a real 50+ task project →
      **revisited 2026-07-23 via GH #58: the 90px width threshold read as
      arbitrary; replaced with measured text fit (label inside iff the full
      name fits) + outside labels tied to their bar by a fill-colored dot.
      See docs/plans/gh-issue-triage-56-59-plan.md Task 4.**
- [ ] Deterministic fallback colors for legacy-slate sections are acceptable
      (explicitly stored custom colors always win; fallback may shift if
      sections are reordered — cosmetic only)

## Not doing (and why)

- **shadcn/ReUI install** — feature regression + stack bootstrap to fix a
  paint problem (see decision above)
- **Engine or geometry changes** — drag/resize, dependencies, baseline,
  milestones, zoom all stay byte-identical
- **Progress overlay in exports** — exports stay solid-fill; screen/export
  color parity is preserved via the shared hex table
- **Percent text on bars** — bars are 14px tall; the tooltip already carries
  progress

## Addendum 2026-07-24 — rejection reversed

The "Evaluated and rejected: ReUI Gantt swap" decision above is **reversed**.
A source-level audit of ReUI's actual Gantt (shadcn registry pull) confirmed
the four feature gaps cited here, and the user chose a full swap anyway:
ReUI Gantt as the engine, the four gaps rebuilt on top, full shadcn bootstrap,
Tailwind v3→v4 migration first. The re-skin this doc produced remains shipped
and its semantics (solid fills, measured-fit labels) carry over into the swap.
Spec: `docs/superpowers/specs/2026-07-24-reui-gantt-swap-design.md`.
