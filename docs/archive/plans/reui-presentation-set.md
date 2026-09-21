# Implementation Plan: ReUI Presentation Set — Phase 1 of the Component Migration

**Branch:** `feat/reui-presentation-set` — already cut from `origin/develop` @ `4ca8f75` (2026-07-31)
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit/PR without explicit user approval.
**Program docs:** `docs/ideas/reui-component-migration.md` (decisions settled — don't re-ask) · `docs/plans/reui-component-migration.md` (roadmap; this is Phase 1).

## Overview

Vendor the five presentation components — `timeline`, `alert`, `frame`, `icon-tile`, `icon-stack` — and wire three bounded consumer sets: the `EmptyState.tsx` rebuild, the `ProjectTimeline.tsx` restyle, and Alert in the five form-error callout sites. Zero new npm dependencies. This phase exists to prove the full vendor loop (CLI pull → radix audit → token-bridge theming → `// SOLVRO PATCH`) before the dep-gated data-grid phase.

Verified at planning time (2026-07-31):

- Runtime deps across all five components: `@base-ui/react`, `class-variance-authority` — both already in `frontend/package.json`. Expected `package.json` diff: **none, byte-identical**.
- None of the five has registry dependencies on missing `ui/` primitives — no `ui/` files land in this phase.
- **Alert consumes tokens Solvro doesn't define yet:** `--success`, `--info`, `--warning`, `--invert` (ReUI extends the shadcn set). They must be added to the semantic-bridge `@theme inline` block in `frontend/src/index.css`, both themes, derived from the Solvro palette in `docs/DESIGN.md` — this is a docs-keeper trigger at phase close.
- `IconTile` auto-sizes **svg children only** (`[&_svg:not([class*=size-])]`); Solvro icons are `material-symbols-outlined` font glyphs, so the glyph's font-size is set by the consumer (`EmptyState.tsx`), not by the tile.
- `Frame` defaults `--frame-radius: var(--radius-xl)` (0.75rem) — Technical Precision uses small radii; consumers override via `[--frame-radius:...]` className, keeping the vendored file clean.
- `EmptyState.tsx` has a stable 4-prop API (`icon` = material-symbols name, `title?`, `message`, `action?`) and 6 consumers (`PortfolioCalendar`, `ServiceMappingList`, `CustomerDetail`, `Customers`, `Executive`, `Projects`) — internals rebuild, consumers untouched.
- `ProjectTimeline.tsx` hand-rolls the spine (`<ol className="relative ml-3 border-l …">` + absolute dot markers). Card content (chips, avatar, status buttons, date/overdue logic on `dateField.ts`) is behavior, not presentation — it must survive unchanged.
- 26 files render `bg-error-container` callouts. Phase 1 migrates **5**: `Login.tsx`, `TaskFormModal.tsx`, `ProjectFormModal.tsx`, `CustomerFormModal.tsx`, `RiskFormModal.tsx` (one shared inline-error pattern). The remaining sweep is recorded in `docs/ISSUES.md` at phase close as deferred follow-up.

## Architecture Decisions

- **Vendor via the ReUI CLI** (`npx shadcn@latest add @reui/<name>` from `frontend/`), one file each under `frontend/src/components/reui/`. Hand edits get `// SOLVRO PATCH`. If the CLI touches `package.json` or `components.json`, revert and investigate before proceeding.
- **Alert semantic tokens land with the vendor task**, not the consumer task — the vendored file must compile and render standalone. Values derive from the existing palette: success ← primary/emerald family, warning ← amber chip family, error already exists, info + invert proposed by the implementor from `docs/DESIGN.md` and flagged for phase review. Both themes (`:root` + `.dark`).
- **`InstallBanner.tsx` is out of scope** (decision 2026-07-31): it is a slim full-width tap-target with 11px type, not a callout — forcing the Alert anatomy onto it would worsen a deliberate mobile design. The idea doc's surface map is corrected accordingly.
- **EmptyState keeps its exact props API.** Rebuild internals on `Frame` (ghost/dashed treatment) + `IconTile` (`soft` or `outline` variant, glyph font-size set locally); all 6 consumers must show zero diff.
- **ProjectTimeline is presentation-only.** ReUI `Timeline`/`TimelineItem`/`TimelineIndicator`/`TimelineSeparator` replace the hand-rolled spine and dots; status→color mapping (DONE emerald, IN_PROGRESS primary, TODO neutral) moves onto `TimelineIndicator` className. Sorting, `subtasksOf`, overdue comparison, status buttons, `TaskFormModal` wiring: byte-for-byte behavior. Single-tab presentation change → phase review covers it (no instant review needed beyond the spine vendor task).
- **Form-error Alerts**: `<Alert variant="destructive">` with `AlertTitle`/`AlertDescription`, replacing the ad-hoc `bg-error-container` divs in the 5 sites. No `AlertAction` — these are passive callouts. Modal layout (`Modal.tsx` edge-to-edge phone behavior) untouched.
- **Out of scope:** the other 21 error-callout sites; `InstallBanner.tsx`; stat-card `Frame` evaluation (deferred to Phase 4 sweep — record in ISSUES.md); any `ui/` primitive; any engine (`gantt-v2/`, `kanban-v2/`, ProjectList).

## Task List

### Wave 1

#### Task 1: Vendor the five components + Alert tokens

**Description:** Pull `@reui/timeline`, `@reui/alert`, `@reui/frame`, `@reui/icon-tile`, `@reui/icon-stack` into `frontend/src/components/reui/` (flat files; move by hand if the CLI misplaces). Verify per file: imports are `@base-ui/react`/`cva`/`clsx`/`tailwind-merge` only — `grep -ri radix` empty; exports match the registry API (Timeline\*, Alert\*, Frame\*, IconTile, IconStack). Add `--success`, `--info`, `--warning`, `--invert` (+ their `--*-foreground` pairs if the alert variants reference them) to the semantic-bridge `@theme inline` block in `src/index.css`, both themes, values derived from `docs/DESIGN.md`'s palette. Mark every hand edit `// SOLVRO PATCH`. No consumers in this task.

**Acceptance criteria:**
- [ ] Five new files under `frontend/src/components/reui/`; `grep -ri radix` on them is empty
- [ ] `frontend/package.json` and `components.json` byte-identical to before the task
- [ ] New tokens present in both themes; no other `index.css` changes
- [ ] `docker compose exec frontend npm run typecheck` green

**Verification:** scoped typecheck by the implementor; **instant opus review (spine: vendored `reui/`)** before Wave 2 starts; orchestrator runs `gates.sh` at wave integration.
**Dependencies:** None
**Files:** `frontend/src/components/reui/{timeline,alert,frame,icon-tile,icon-stack}.tsx`, `frontend/src/index.css`
**Size:** M

### Checkpoint A (gate for Wave 2)
- [ ] Task 1 instant opus review clear; gates green

### Wave 2 — parallel (disjoint files)

#### Task 2: EmptyState rebuild

**Description:** Rebuild `frontend/src/components/EmptyState.tsx` internals on `Frame` + `IconTile`: `Frame` (or `FramePanel`) carries the dashed-border empty-surface treatment with `[--frame-radius:var(--radius-sm)]` to hold Technical Precision radii; `IconTile` (size `lg` or `xl`, decorative `aria-hidden`) wraps the `material-symbols-outlined` glyph with an explicit font-size class (the tile only auto-sizes svgs). Props API unchanged: `icon`, `title`, `message`, `action`.

**Acceptance criteria:**
- [ ] `EmptyState.tsx` props API unchanged; all 6 consumer files show zero diff
- [ ] Visual parity check at 375px and desktop against the current dashed empty state
- [ ] Typecheck green

**Verification:** scoped typecheck + affected view smoke; gates at wave integration.
**Dependencies:** Task 1
**Files:** `frontend/src/components/EmptyState.tsx`
**Size:** S

#### Task 3: ProjectTimeline restyle

**Description:** In `frontend/src/pages/views/ProjectTimeline.tsx`, replace the hand-rolled `<ol>` spine and absolute dot markers with `Timeline`/`TimelineItem`/`TimelineIndicator`/`TimelineSeparator`/`TimelineHeader`/`TimelineContent`. Map status colors onto `TimelineIndicator` (`DONE` → emerald, `IN_PROGRESS` → primary, `TODO` → neutral). Keep the card body markup and all behavior identical: ordering memo, `subtasksOf`, overdue day-comparison, status buttons, edit-modal wiring, loading/error/empty branches. The empty branch may reuse `EmptyState` if it lands first — otherwise keep the current div (don't create a cross-task file dependency).

**Acceptance criteria:**
- [ ] Task cards render the same chips, dates, avatar, status buttons; edit modal still opens
- [ ] Overdue highlighting and DONE/IN_PROGRESS/TODO indicator colors correct in both themes
- [ ] Scroll container behavior unchanged (`md:` overflow region); usable at 375px
- [ ] Typecheck green

**Verification:** scoped typecheck + tab smoke; phase review covers the single-tab presentation change.
**Dependencies:** Task 1
**Files:** `frontend/src/pages/views/ProjectTimeline.tsx`
**Size:** M

#### Task 4: Alert in the five form-error sites

**Description:** Replace the ad-hoc `bg-error-container` callout divs with `<Alert variant="destructive">` + `AlertTitle`/`AlertDescription` in `pages/Login.tsx`, `components/TaskFormModal.tsx`, `components/ProjectFormModal.tsx`, `components/CustomerFormModal.tsx`, `components/RiskFormModal.tsx`. Passive callouts only — no `AlertAction`. Preserve each site's show/hide condition and message text exactly. Do not touch the other 21 callout sites.

**Acceptance criteria:**
- [ ] All five sites render the Alert on the same error conditions with the same copy
- [ ] Modal layouts and Login layout unaffected; edge-to-edge phone behavior intact
- [ ] Error styling reads from the semantic tokens (no raw hex/utility color additions)
- [ ] Typecheck green

**Verification:** scoped typecheck + form-error smoke (submit invalid form); gates at wave integration.
**Dependencies:** Task 1
**Files:** `frontend/src/pages/Login.tsx`, `frontend/src/components/{TaskFormModal,ProjectFormModal,CustomerFormModal,RiskFormModal}.tsx`
**Size:** M

### Phase close
- [ ] One `solvro-reviewer` phase review on the combined diff (frontend touched → reads `docs/DESIGN.md` live; checks token values against `index.css`)
- [ ] CHANGELOG: implementors report entry text; orchestrator appends serially under `[Unreleased]`
- [ ] docs-keeper **triggered** (`index.css` touched → DESIGN.md token-table sync; also files the deferred 21-site alert sweep + stat-card Frame evaluation into `docs/ISSUES.md`)
- [ ] `TaskStop` every spawned agent; stage, draft commit messages + PR body targeting `develop`, assign `alfi-rajasyah` — then STOP for user approval

## Risks

- **Token derivation is a design call:** success/info/warning/invert values must come from the Solvro palette, not ReUI defaults — implementor proposes, phase review + docs-keeper verify against `docs/DESIGN.md`.
- **Radius drift:** Frame's `--radius-xl` default and IconTile's active-style radius may read rounder than Technical Precision — consumer-level overrides, checked visually in both themes.
- **Timeline is behavior-dense:** the restyle touches a file full of date-contract logic (`dateField.ts` helpers). Any diff beyond markup/classNames is a red flag for the phase review.
- **CLI side effects:** any unrequested `package.json`/`components.json` diff fails Task 1's acceptance outright.
- **Playwright smoke breadth:** gates' frontend smoke may not walk form-error paths; Task 4's implementor must demonstrate the error state manually (screenshot or step list in its report).
