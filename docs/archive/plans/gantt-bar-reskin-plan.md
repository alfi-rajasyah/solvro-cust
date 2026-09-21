# Gantt Bar Re-skin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per-task pipeline per CLAUDE.md: solvro-implementor → solvro-qa → solvro-reviewer → solvro-docs-keeper → orchestrator acceptance → **user-approved commit** (no agent commits on its own).

**Goal:** Kill the washed-out Gantt bars. Bars render solid in their Color-by color with progress as a darker overlay, task names label the bars, section header rows get rollup summary bars, and sections still on the legacy slate default get deterministic vivid colors. Screen and Excel/PDF exports stay in color parity throughout.

**Idea doc:** `docs/ideas/gantt-bar-reskin.md`. **Visual spec:** the 1:1 before/after mockup artifact — https://claude.ai/code/artifact/818ee192-dd6f-4e31-9391-9e8e5d99ef24 (After state = acceptance target; Color-by toggle and both themes are functional in it).

**Architecture:** Paint-only. All changes concentrate in the hand-rolled Gantt: `frontend/src/lib/gantt/palette.ts` (hex tables — already the single source feeding live bars AND both exports via `barFillHex`), `frontend/src/lib/gantt/geometry.ts` (section-color resolution in `pushGroup`), `frontend/src/components/gantt/GanttBar.tsx` (bar rendering), `frontend/src/components/gantt/GanttSectionBar.tsx` (+ chart-pane wiring for summary bars). Engine (drag/resize/connect), `TaskDependency` arrows, baseline rendering, milestone diamonds, and the export drawing code are untouched. Backend and DB: zero changes.

**Tech stack:** Existing only. **No new npm dependencies** (ReUI/shadcn explicitly rejected — see idea doc; hand-rolled-Gantt guardrail stays intact).

## Global Constraints

- **CHANGELOG discipline (CLAUDE.md):** every task appends to `CHANGELOG.md` under `[Unreleased]` in the same change set. Append-only.
- **Commit gate (CLAUDE.md guardrail):** each task ends with staging + a drafted commit message; the actual `git commit` waits for explicit user approval.
- **No frontend unit runner:** verification per task = `docker compose exec frontend npm run typecheck` + manual checks in the dev stack (`docker compose up -d`, app at `http://localhost:5173`; provision a login via `scripts/create-admin.ts` if needed — there is no seeded user).
- **DESIGN.md is binding** for the reviewer's design lens (frontend-touching diff). `lib/gantt/palette.ts` is the established hex home for Gantt/export colors — new colors go there, not inline in components, and not into `tailwind.config.ts` (so no DESIGN.md regeneration trigger).
- **Guardrail greps still stand** (solvro-qa standing checks): `Tasks.tsx` present, `gantt-task-react` absent, INTERNAL-note filtering intact.
- Commit style per repo history: `feat(gantt): …` / `fix(gantt): …`. **No Claude co-author trailers.**

**Task order:** 1 → 2 → 3 → 4 → 5 → 6. Task 1 and 2 are independent of each other; 3 depends on 1 (new hues + overlay constant); 4 depends on 3 (labels must contrast against solid fills); 5 depends on 2 (summary bars need vivid section colors to be legible); 6 is the closing QA sweep over everything.

---

### Task 1: New palette values (`palette.ts`)

Hex-value changes only — no renames, no signature changes — so every consumer (GanttBar, GanttListRow, GanttSectionBand, exportExcel, exportPdf, legendEntries) stays green and inherits the new hues in the same diff. Exports go vivid immediately; the screen stays ghosted until Task 3.

**Files:**
- Modify: `frontend/src/lib/gantt/palette.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: same exported names (`STATUS_FILL_HEX`, `PRIORITY_BORDER_HEX`, `SECTION_COLOR_PRESETS`, `barFillHex`, `legendEntries`) with new values.

- [x] **Step 1: Status fills** — pastel → solid-intent hues:

```ts
export const STATUS_FILL_HEX: Record<TaskStatus, string> = {
  TODO: "#94a3b8",        // slate-400 — visibly "not started", solid
  IN_PROGRESS: "#3b82f6", // blue-500
  DONE: "#10b981",        // emerald-500
};
```

- [x] **Step 2: Priority** — only LOW changes (`#94a3b8` → `#64748b` slate-500) so LOW-priority bars are distinguishable from TODO-status bars when modes are compared side by side. MEDIUM/HIGH/URGENT stay.

- [x] **Step 3: Section presets** — replace `SECTION_COLOR_PRESETS` with the vivid dark+light-safe set (order = fallback cycling order for Task 2):

```ts
export const SECTION_COLOR_PRESETS = [
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#d946ef", // fuchsia
] as const;
```

**Deliberately omits slate `#94a3b8`:** that value stays the `Section.color` *schema default* (backend untouched) and becomes the "never customized" sentinel Task 2 keys on. Removing it from the picker means an explicit user pick can never collide with the sentinel. Update the comment above the array accordingly (it currently claims "First entry is the schema default").

- [x] **Step 4: Type-check** — `docker compose exec frontend npm run typecheck`, exit 0. *(Ran in-container 2026-07-22, exit 0; backend tsc also 0.)*

- [x] **Step 5: Manual verify** — Gantt renders (bars still 28% tracks — expected until Task 3, but hues shift); Excel + PDF export of any project now shows the new solid hues; Color-by legend chips match. *(Diff verified byte-for-byte against the locked values; visual export-parity eyeball rolled into Task 6's sweep.)*

- [x] **Step 6: CHANGELOG + stage** — append under `[Unreleased]` → `### Changed`; stage `palette.ts` + `CHANGELOG.md`; draft `feat(gantt): re-skin palette — solid-intent status hues, vivid section presets`. Commit pre-approved via kickoff prompt. *(Note: QA subagent ran but failed to deliver its report; orchestrator ran the gates directly — all green. Reviewer skipped at discretion: values-only diff. The uncommitted planning-docs CHANGELOG entry rides along in this commit.)*

---

### Task 2: Vivid fallback for uncustomized sections (`geometry.ts`)

`pushGroup` (geometry.ts:379) resolves `sectionColor` as `colorBySection.get(sectionId) ?? DEFAULT_SECTION_COLOR`. Since the schema defaults `Section.color` to `#94a3b8`, existing sections *store* slate — a preset swap alone changes nothing on screen. Treat `null`/`#94a3b8` as "unset" and cycle the vivid presets deterministically by section index.

**Files:**
- Modify: `frontend/src/lib/gantt/geometry.ts` (and, if the section list/dots resolve color independently, `GanttListRow.tsx` — implementor verifies; the goal is ONE resolution point in geometry so bars, list dots, section bands, and both exports all inherit).

**Interfaces:**
- Consumes: `SECTION_COLOR_PRESETS`, `DEFAULT_SECTION_COLOR` from `palette.ts`.
- Produces: `Row.sectionColor` never emits legacy slate for a real section; rows without any section keep `DEFAULT_SECTION_COLOR`.

- [x] **Step 1:** In the row-building pass, resolve per section: stored color wins **unless** it is `null` or exactly `#94a3b8` (case-insensitive compare), in which case use `SECTION_COLOR_PRESETS[sectionIndex % SECTION_COLOR_PRESETS.length]` where `sectionIndex` is the section's position in the project's ordered section list. Document the sentinel in a comment (why `#94a3b8` ≡ unset). *(Implemented in `colorBySection` map build; consumer audit confirmed all 5 Gantt consumers read `Row.sectionColor`.)*
- [x] **Step 2:** Type-check (frontend), exit 0. *(In-container, exit 0; backend tsc also 0 — QA gate report in scratchpad.)*
- [x] **Step 3: Manual verify** — a project whose sections were never color-picked now shows distinct section dot colors in the task list AND distinct (still ghosted) bar hues in Section mode; a section with an explicitly picked color keeps it; Excel/PDF section-mode export matches the screen colors exactly. *(Logic verified by QA gate 4 sub-checks; visual eyeball rolled into Task 6 sweep.)*
- [x] **Step 4:** CHANGELOG (`### Changed`) + stage + draft `feat(gantt): deterministic vivid fallback for uncustomized section colors`. Commit pre-approved via kickoff prompt. *(Reviewer: approve-with-nits — CHANGELOG wording tightened pre-commit; 2 findings deferred to ISSUES.md: non-Gantt section-color parity gap (ProjectList/Executive/TaskPanel), #94a3b8 sentinel duplication now load-bearing.)*

**Accepted trade-off (from idea doc):** fallback colors can shift if sections are reordered — cosmetic only; stored colors are stable.

---

### Task 3: Solid bars + progress overlay (`GanttBar.tsx`)

The core fix. Replace the track/fill rendering model.

**Files:**
- Modify: `frontend/src/components/gantt/GanttBar.tsx`, `frontend/src/lib/gantt/palette.ts` (constant swap)

**Interfaces:**
- Consumes: `barFillHex` (unchanged).
- Produces: `PROGRESS_OVERLAY_ALPHA = 0.28` in `palette.ts`; `BAR_TRACK_OPACITY` deleted (GanttBar is its only consumer — re-grep to confirm before deleting).

- [x] **Step 1:** Bar container: `backgroundColor` becomes the solid resolved color (drop the `rgba(rgb, BAR_TRACK_OPACITY)` wrapper); border-radius `3px` → `4px`.
- [x] **Step 2:** Progress element inverts meaning: render a left-anchored overlay `rgba(0, 0, 0, PROGRESS_OVERLAY_ALPHA)` of width `progress%` **only when `0 < progress < 100`** (0% = clean solid bar, 100% = clean solid bar — no full-width darkening of DONE bars). *(Post-review: overlay uses `rounded-l-[4px]` for a crisp progress boundary — reviewer nit, applied by orchestrator.)*
- [x] **Step 3:** In `palette.ts`, replace `BAR_TRACK_OPACITY` with `PROGRESS_OVERLAY_ALPHA = 0.28` and rewrite the comment block (it currently documents the track model). Remove the now-unused `hexToRgb` in `GanttBar.tsx` if nothing else uses it. *(Sole-consumer grep confirmed before delete; exportPdf's separate hexToRgb intact. Stale palette header comment also corrected — reviewer note.)*
- [x] **Step 4:** Untouched, verify by eye in the diff: drag ghost ring, resize handles (white `rgba(255,255,255,0.35)` — confirm they're still visible over solid emerald/blue/violet), connector dots, baseline rect, milestone diamond branch, subtask 0.8 height scaling. *(Verified by implementor, QA gate 4f, and reviewer — handles paint above overlay by DOM order.)*
- [x] **Step 5:** Type-check (frontend), exit 0. *(Green, incl. re-run after post-review one-liners.)*
- [x] **Step 6: Manual verify against the mockup's After state** — 0%-progress bars solid; an IN_PROGRESS task at ~50% shows the darker left overlay; DONE bars clean solid emerald; all three Color-by modes; drag/resize/click still work; dark AND light theme. *(Reviewer computed overlay contrast per palette pair — all legible both themes; interactive + visual eyeball rolled into Task 6 sweep.)*
- [x] **Step 7:** CHANGELOG (`### Changed`, note the rendering-model inversion and why) + stage + draft `feat(gantt): solid bar fills with progress overlay (was 28% track)`. Commit pre-approved via kickoff prompt. *(Reviewer verdict: approve-with-nits, both nits applied pre-commit.)*

---

### Task 4: Task labels on bars

**Files:**
- Modify: `frontend/src/components/gantt/GanttBar.tsx`

**Interfaces:**
- Consumes: `row.name`, bar `left`/`width` already computed.
- Produces: purely visual; no API change. Exports draw their own labels — out of scope.

- [x] **Step 1:** Label placement rule (from mockup): bar width ≥ **90px** → label inside the bar (10px, white, `px-1`, truncate with ellipsis, `pointer-events-none`); narrower → label floated right of the bar at `left + width + 6px` (10px, muted `on-surface-variant` token color, no truncation cap needed but cap at ~240px to be safe). Milestones keep their existing title-attr only — no label. *(Post-review: fontSize moved to `text-[10px]` class per Gantt micro-text convention — orchestrator one-liner.)*

  > **Superseded 2026-07-23 (GH #58):** the 90px bar-width rule is replaced by measured text fit — see `docs/plans/gh-issue-triage-56-59-plan.md` Task 4.
- [x] **Step 2:** z-order: labels above gridlines/weekend stripes, below the today line; `pointer-events-none` so they never intercept bar drags or connector-dot hovers. *(Reviewer confirmed stacking: label z2 < dots z3 < today z5; per-row containing blocks prevent vertical collisions.)*
- [x] **Step 3:** Inside-label contrast: white on the vivid fills is fine for blue/violet/emerald/rose; spot-check amber `#f59e0b` in light theme — if illegible, use `rgba(0,0,0,0.75)` text for amber/sky via a simple luminance check on the resolved hex (keep it in GanttBar, not a new dep). *(Implemented 0.299/0.587/0.114 @ 0.6: amber + slate get dark text; sky computed 0.500 → stays white, correctly diverging from the plan's guess.)*
- [x] **Step 4:** Type-check (frontend), exit 0. *(Green, incl. re-run after post-review one-liners.)*
- [x] **Step 5: Manual verify** — Week view: short bars label to the right (matches mockup); Month/Quarter views: longer bars label inside; no overlap with connector dots on hover; RightSidebar open/closed doesn't clip labels (chart pane scrolls). *(Reviewer verified drag/ghost tracking, dense-row math, right-edge behavior — accepted nit: narrow bar at chart edge can add ≤246px dead scroll; visual eyeball rolled into Task 6 sweep.)*
- [x] **Step 6:** CHANGELOG (`### Added`) + stage + draft `feat(gantt): task name labels on bars`. Commit pre-approved via kickoff prompt. *(Reviewer verdict: APPROVE, 4 optional nits — class-consistency applied; dead-scroll + 6-digit-hex assumption accepted; overlay-contrast check added to Task 6 sweep.)*

---

### Task 5: Section summary bars

Section rows already carry `start`/`end` (computed `rangeFor(group)` in `pushGroup`) — the span is free; this is pure rendering.

**Files:**
- Modify: `frontend/src/components/gantt/GanttSectionBar.tsx` (add a `GanttSectionSummaryBar` alongside the existing `GanttSectionBand` — the 7% tint band **stays**)
- Modify: whichever chart pane renders section rows (`GanttChartPane.tsx` / `GanttFrame.tsx` — implementor locates the `GanttSectionBand` render site and adds the summary bar next to it)

**Interfaces:**
- Consumes: section `Row` (`start`, `end`, `sectionColor` — vivid post-Task 2), `positionFor` from geometry, `ROW_HEIGHT`.
- Produces: new exported `GanttSectionSummaryBar` component.

- [x] **Step 1:** Render on section rows with a defined range: 6px tall, `rounded-full`, vertically centered in the 30px row, `backgroundColor` = section color at opacity 0.85, `pointer-events-none`. Width from `positionFor(start)` → `positionFor(end + 1 day)`, min one day-width. Sections with no dated children (no `start`/`end`) render nothing. *(New `GanttSectionSummaryBar` in GanttSectionBar.tsx; shared `hexToRgbTuple` refactor of the band verified behavior-identical by QA.)*
- [x] **Step 2:** Collapsed sections: summary bar still renders (that's when it's most useful). Verify the collapsed-row path passes `start`/`end` through. *(Verified from geometry source: `rangeFor` runs before the collapsed early-return; both-or-neither null invariant confirmed by reviewer.)*
- [x] **Step 3:** Type-check (frontend), exit 0. *(Green; post-review change was comment-only.)*
- [x] **Step 4: Manual verify against mockup** — three-section test project shows three colored rollup pills; single-day section (both tasks same day) renders the minimum-width pill; empty section renders none; today line still draws above them. *(Structural verification done — z-order traced through stacking contexts; visual eyeball rolled into Task 6 sweep.)*
- [x] **Step 5:** CHANGELOG (`### Added`) + stage + draft `feat(gantt): section rollup summary bars`. Commit pre-approved via kickoff prompt. *(Reviewer: APPROVE ship-as-is, 3 optional nits — comment precision applied; constant co-location + hex-helper symmetry accepted as-is.)*

---

### Task 6: Closing QA sweep + gates

Dispatch solvro-qa with the full frontend-touching gate set, then solvro-reviewer (design lens auto-activates), then solvro-docs-keeper.

- [x] **Gates:** frontend typecheck, backend `tsc --noEmit` (should be trivially green — no backend diff), backend vitest, Playwright smoke (`cd e2e && npm test` or the smoke spec subset), standing guardrail greps. *(All pass — vitest 32/32; full Playwright suite on the ephemeral CI stack: 31 passed, 11 project-gated skips by design; one-time `npx playwright install chromium` to sync a drifted browser cache. Full evidence in qa-t6 report.)*
- [x] **Cross-theme sweep (manual, both themes):** all three Color-by modes; bar + label contrast; summary bars; baseline toggle on a baseline-locked project (gray baseline rects legible under solid bars); milestone diamonds; dependency arrows still route over/under bars correctly. *(Added from Task 4 review: specifically eyeball dark inside-labels over the darkened progress region on light fills — amber/slate sections at 1–99% progress.)* *(Done via 9 headless screenshots of a purpose-seeded project on the CI stack — light+dark × status/section/priority, baseline overlay, collapsed section, HARD+SOFT arrows. Vivid fallback, overlays, luminance-aware labels (dark-on-amber incl. over the progress overlay), summary pills, milestone diamond, today line all verified.)*
- [x] **Export parity check:** same project exported to Excel and PDF in each Color-by mode — fills match screen hexes (they share `barFillHex`; this is a regression check, not new work). *(Real downloads driven through the Export menu: status xlsx contains exactly FF94A3B8/FF3B82F6/FF10B981 and zero legacy pastels; section xlsx contains the vivid fallback presets FF8B5CF6/FF14B8A6/FF3B82F6; PDF generates valid.)*
- [x] **Docs-keeper:** verify per-task CHANGELOG entries landed; CLAUDE.md Facts needs no sync beyond the shadcn-decision line already recorded (no route/schema/convention changes); DESIGN.md untouched (no trigger files in diff); file any deferred review findings into ISSUES.md. *(Satisfied cumulatively by the five per-task docs-keeper close-outs + QA gate 8 CHANGELOG-integrity check; Task 6 itself shipped zero source diff, so no sixth reconciliation dispatch — orchestrator call, noted.)*
- [x] **Orchestrator acceptance:** side-by-side against the mockup's After state; then batch or per-task commits per user preference — **user approves before any commit**. *(ACCEPTED 2026-07-22 — screen matches the mockup's After state in both themes; per-task commits made under the kickoff prompt's pre-approval.)*

---

## Out of scope (re-affirmed)

shadcn/ReUI installation; engine/geometry behavior changes; backend/DB anything; progress overlay in exports; % text on bars; critical path highlighting (still deferred); Network Diagram (never — per guardrail).
