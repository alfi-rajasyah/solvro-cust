# GitHub Issue Triage — #56, #57, #58, #59

Triaged 2026-07-23 from four issues filed by `hapsarapramudita-elitery` (first external dogfooding feedback). All four verified against up-to-date `origin/develop` (`aabf3a6`) via parallel code investigation; every claim below carries a file:line. No code changed during triage.

## Problem Statement

1. HMW stop label creation inside the task drawer from destroying the user's in-progress task? (#56)
2. HMW make user-generated prose (comments, descriptions) always wrap instead of escaping its container? (#57)
3. HMW make Gantt bar-label placement read as intentional instead of arbitrary? (#58)
4. HMW align the task form's date fields with the app-wide Start→Due convention? (#59)

## Triage Verdicts

| Issue | Verdict | Severity | Root cause |
|---|---|---|---|
| #56 Label crash | **Bug (data loss)** | **P0** | Nested `<form>`: label submit bubbles into the task-form submit |
| #57 Comment overflow | Bug (layout) | P1 | `whitespace-pre-wrap` without `break-words` |
| #58 Gantt labels | **Not a bug — shipped spec needs revisiting** | P1 (perceived quality) | Fixed 90px threshold ignores whether text fits |
| #59 Date order | Valid consistency request | P2 | `TaskFormModal` is the only Due-before-Start surface in the app |

## Context (code findings)

### #56 — two independent defects, both in the task drawer

- `LabelPicker` renders its own `<form onSubmit={handleCreate}>` (`frontend/src/components/LabelPicker.tsx:85`) with a `type="submit"` Add button (`:100`) — and `TaskFormModal` mounts it *inside* `#task-form` (`frontend/src/components/TaskFormModal.tsx:256` … `:385` … `</form>` at `:454`). React 18 replays the bubbling `submit` up the fiber tree (it does not drop nested forms the way the HTML parser does). `handleCreate` calls `preventDefault()` but never `stopPropagation()` (`LabelPicker.tsx:40`), so the **outer** `handleSubmit` (`TaskFormModal.tsx:122`) also fires: with a title present it prematurely creates/saves the task and closes the drawer (`requestClose()` at `:171` → unmount → all `useState` field state destroyed = the reported "crash + data loss"); with no title it throws a spurious "Title is required." error. The new label isn't even attached — the outer submit races ahead of the label mutation's `await`.
- Independent second hazard: the form-reset effect depends on the whole `props` object (`TaskFormModal.tsx:112` — `[open, isEdit, props]`). Parents pass inline closures (e.g. `ProjectKanban.tsx:677`), so **any** parent re-render (query refetch, sibling mutation invalidation) re-fires the reset and blanks every field while the drawer is open.
- Only `TaskFormModal` nests the picker — `TaskPanel.tsx:516` uses `LabelPicker` outside any form and is unaffected. Backend wiring (`POST /projects/:id/labels`, `backend/src/routes/projects.ts:678`) is correct; no validation/response-shape issue.
- Zero test coverage exists for labels (backend or e2e).

### #57 — missing word-break on prose

- Comment body: `<p className="whitespace-pre-wrap text-xs …">` at `frontend/src/components/TaskPanel.tsx:672` — `pre-wrap` only wraps at whitespace; an unbroken string overflows. Parent bubble already has `min-w-0 flex-1` (`:667`), and no ancestor clips (`overflow-y-auto` only at `:303`), so text runs off-screen. Fix belongs on the `<p>`.
- Username span (`:669`) can push the timestamp out — same family, add `truncate`/`min-w-0`/`shrink-0`.
- `frontend/src/components/CommentThread.tsx` is a **dead duplicate** (exported, imported nowhere) carrying the identical bug at `:52` — delete it rather than patch dead code.
- Same-class latent bug: `frontend/src/pages/CustomerDetail.tsx:182` (`whitespace-pre-line`, no `break-words`).
- There is no existing `break-words` prose precedent in the app — this fix sets it: **`whitespace-pre-wrap break-words`** is the standard for user-generated prose from now on.

### #58 — implementation matches spec; the spec is what the reporter objects to

- Placement is decided by bar *pixel width* alone: `INSIDE_LABEL_MIN_WIDTH = 90` (`frontend/src/components/gantt/GanttBar.tsx:27`, decision at `:120`). The number came from the mockup (`docs/plans/gantt-bar-reskin-plan.md:124`), not from measurement.
- At the default Week zoom (20px/day) the threshold is 4.5 days — real 3–6-day tasks straddle it, so charts split roughly half inside / half outside. A 92px bar with a 40-char name goes *inside* (ellipsised to ~10 chars) while an 88px bar with a 6-char name goes *outside* in full: "inside" never meant "it fits".
- The two treatments also look unrelated (white-on-fill vs. floating muted gray), which is half the perceived bug.
- The reskin idea file left this exact assumption open: *"revisit after dogfooding a real project"* (`docs/ideas/gantt-bar-reskin.md:65-66`). Issue #58 is that dogfooding signal.
- PDF export has a *different* rule (`exportPdf.ts:315`: >60px, no outside fallback) — pre-existing divergence, out of scope here.

### #59 — one outlier surface

- `TaskFormModal.tsx:323-343` renders Due Date before Start Date. All 7 other paired surfaces (TaskPanel `:383/:392`, InlineDateRangeEditor `:72/:83`, Gantt list row, Timeline, Excel/PDF exports) are already Start→Due, and the modal's own validation copy speaks Start→Due (`:129-130`). The swap *restores* convention. Icons must travel with their fields (`calendar_month`=Start, `calendar_today`=Due). No test asserts field order — zero breakage.

## Recommended Direction

One branch off `origin/develop`, four tasks in severity order (#56 → #57 → #59 → #58), one commit per task, single PR to `develop` referencing all four issues. All fixes are frontend-only — no schema or backend route changes.

1. **#56**: De-nest — LabelPicker's inner `<form>` becomes a `<div>`, Add becomes `type="button"`, Enter handled on the input. Narrow the reset-effect deps from `props` to stable primitives. New e2e spec proves the drawer survives label creation with draft intact and no phantom task created.
2. **#57**: `break-words` on the comment body + username hardening; same one-word fix on CustomerDetail; **delete** dead `CommentThread.tsx`. New e2e spec asserts `scrollWidth <= clientWidth` on a 300-char unbroken comment.
3. **#59**: Swap the two `FieldRow` blocks, icons travelling with fields.
4. **#58**: Replace the 90px guess with **measured text fit** (cached canvas `measureText` against the real label font) — a label goes inside iff the *full* name fits; otherwise outside, restyled to read intentional (bar-fill leading dot + `text-on-surface`, vertically centered) with a `data-label-for` hook for tests. This deliberately does **not** honor the literal ask ("always inside"): at 20px/day a 1-day bar would render "…" or nothing — strictly worse than a floated label. Measured-fit + visual tie-back resolves the actual complaint (arbitrary-looking placement).

## Key Assumptions to Validate

- [ ] React's submit-bubbling is the real #56 trigger — validated when the new e2e spec fails on unfixed code and passes after the LabelPicker change
- [ ] `break-words` (not `break-all`) is enough for a lone 300-char token inside the 380px panel — e2e overflow assertion confirms
- [ ] Canvas `measureText` with the theme font string (`10px "Source Sans 3", system-ui, sans-serif`) tracks the DOM within the 12px slack — manual verify at Day/Week/Month zooms, both themes
- [ ] The outside-label restyle passes the reviewer's design lens against DESIGN.md

## MVP Scope

**In:** all four fixes above, three new e2e specs (`task-form-labels`, `comments`, `gantt-bar-labels`), CHANGELOG entries per task, docs sync (tick the reskin dogfooding checkbox, supersede the 90px rule note).
**Out:** everything under Not Doing.

## Not Doing (and Why) — deferred items for ISSUES.md

- **Always-inside labels (#58 literal ask)** — destroys labels on short bars at Week zoom; measured-fit chosen instead (rationale above)
- **"Labels: auto/inside/off" toolbar toggle** — heaviest option, prop-drills through four components; revisit only if measured-fit still draws complaints
- **PDF export label parity** — pre-existing divergence (`exportPdf.ts:315`), separate concern → ISSUES.md
- **Permission asymmetry**: `POST /projects/:id/labels` requires `project:write` while label PATCH/DELETE and the task form gate on `task:write` — latent (TAM holds both, ADMIN wildcard), no current-role impact → ISSUES.md
- **Duplicate-label-name 409 UX** — generic "Unique constraint violated" message surfaces raw; cosmetic → ISSUES.md
- **Comment composer auto-grow textarea** — single-line input scrolls fine; UX polish, not the reported bug → ISSUES.md
- **Backfilling label CRUD vitest coverage** — no backend behavior changes in this sprint; belongs with the permission-asymmetry fix when picked up

## Open Questions

- None blocking. The #58 direction (measured-fit over always-inside) is the one judgment call that overrides the reporter's literal request — flag at review if it feels wrong; the plan isolates it in its own task/commit so it can be dropped without touching the other three fixes.
