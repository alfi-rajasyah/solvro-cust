# Future consideration: adopt the vendored (shadcn) focus style app-wide

**Status: NOT planned — parked for the user's future consideration.**
Written 2026-07-31, when the opposite direction was chosen (Phase 2 Task 1b unified all vendored form controls onto the app/DESIGN.md 2px style). This doc records what flipping that decision would take, so it can be weighed later without re-deriving the analysis.

## The two styles

| | App style (current winner) | Vendored shadcn style (this doc) |
|---|---|---|
| Focus ring | `ring-2 ring-primary/30` (DESIGN.md §4) | `ring-[3px] ring-ring/50` — softer, wider halo |
| Input surface | `bg-surface-container-lowest` (§1 "deepest inset") | `bg-transparent` + `dark:bg-input/30` |
| Input radius | `rounded-sm` (0.25rem) | `rounded-md` (0.375rem) |

## What would change

### 1. `docs/DESIGN.md` — user-owned edits (the binding doc moves first)
- §4: focus treatment cap rewritten from "2px primary outline" to the 3px `ring-primary/50` halo.
- §1: the input-surface row ("inputs, deepest inset → `surface-container-lowest`") loosened to allow the transparent/`input/30` treatment.
- §3: input radius prescription `rounded-sm` → `rounded-md`.
- Docs-keeper regenerates the affected tables; the paper-extraction source (`docs/reference/paper-extraction/`) may also need an annotation that the app diverged deliberately.

### 2. Vendored files — patches removed (the cheap half)
Task 1b's `// SOLVRO PATCH` focus-ring edits in `ui/button.tsx`, `checkbox.tsx`, `calendar.tsx`, `input.tsx`, `textarea.tsx`, `input-group.tsx` revert to upstream defaults. Future re-pulls get simpler (no ring re-patching). The shadow strips are a separate decision and could stay either way.

### 3. Hand-written controls — the expensive half
Measured 2026-07-31: **~21 focus-ring sites across 22 files** (`grep -rn "focus:ring-2|focus-visible:ring-2|focus:border-primary"`):
- Form modals: `CustomerFormModal`, `TaskFormModal`, `ProjectFormModal`, `RiskFormModal`
- Pages: `Admin`, `DailyReview`, `Projects`, `Settings`, `Tasks`, `ProjectList`, `ProjectRisks`
- Components: `TaskPanel`, `LabelPicker`, `ServiceMappingList`, `ServiceCatalogueManager`
- **Spine files (instant opus review each):** `DateField.tsx`, `DateRangeField.tsx`, `reui/gantt/gantt-view.tsx`, `reui/gantt/gantt-bar.tsx`, `gantt-v2/SolvroGantt.tsx`, `kanban-v2/SolvroKanban.tsx`, plus `reui/autocomplete.tsx`
Each site: ring class swap, and for inputs also surface/radius alignment if full parity is wanted. Login's dark-pinned column and the ⌘K palette need individual visual checks.

### 4. Process cost
- A dedicated phase (branch = PR): roughly Task-1b-sized × 4, dominated by the spine reviews and app-wide visual verification (both themes, 375px + desktop, every touched surface).
- e2e: any screenshot-comparison or class-asserting tests touching focus states need review.
- CHANGELOG: one app-wide "Changed" entry; user-facing look of every focused control changes.

## What does NOT change either way
- Semantic tokens and the `index.css` bridge (ring color still derives from `--primary` / `--ring`).
- Component structure, behavior, keyboard handling.
- The Base-UI guardrail — this is styling only.

## Recommendation recorded at write time
Stay on the app 2px style (chosen 2026-07-31): the binding doc already prescribes it, hand-written sites outnumber vendored ones, and the crisp outline fits Technical Precision's density. Flip only if the softer shadcn halo is visually preferred after seeing Task 1b's unified result in the running app.
