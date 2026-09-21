# Kanban → ReUI Swap — Task Checklist

> Working checklist for `plan.md` (same directory). Check items only when the task's
> verification commands have actually passed. Branch: `feat/kanban-reui-swap` off
> fresh `origin/develop`.

## Phase 0 — Behavior spec
- [x] T1: Scenario table from `ProjectKanban.tsx` comments + `taskOrdering.ts` → `scenarios.md` (23 rows, QA pass)
- [x] T2: e2e coverage audit of `kanban-dnd.spec.ts` against T1 (2 covered / 18 gap / 3 obsolete; gap cases G1–G10; QA pass)

### CP0 — user reviews scenario table (binding for T5/T10)
- [x] Scenario table approved (CP0 2026-07-26)
- [x] Gap list agreed (G9→priority filter; RG-4→backend vitest; SC-4→G3; SC-5→T7; T13 added for RG-1)

## Phase 1 — Pure logic
- [x] T3: Vendor `@reui/kanban` (single file `reui/kanban.tsx`, 947 lines, zero patches; ships 250ms touch delay; collision = rectIntersection default)
- [x] T4: Frontend Vitest setup (vitest ^4.1.10 matching backend; wired into CI post-review)
- [x] T5: `adapter.ts` + `commitMapper.ts` + unit tests (30 green incl. WYSIWYG duals + review hardening; QA + reviewer pass, no blockers)

### CP1 — expressiveness gate
- [x] Mapper tests green; no semantic vendor patch needed (patch count 0)
- [x] No inexpressible requirement found — WYSIWYG drop-on-card semantics accepted (plan addendum 6, T7 payload check pending)

## Phase 2 — UI slices at /kanban2 (old board untouched)
- [x] T6: Static board slice (render assertions + screenshots green; orchestrator parity check: fade/height deltas → fixed in T7; column "…" menu → T8)
- [x] T7: Drag slice (7 live cases green w/ captured payloads; WYSIWYG resolved = insert-before only; fade + full-height fixed via className, patches still 0)
- [x] T8: Filters + subtask checklist (toggle only) + MobileMoveSheet + column add-menu (desktop cases 1/2/4/5 green w/ payloads; addendum-8 desktop leg clean; move-sheet e2e deferred to T9 — mobile columns overlap pre-pager)
- [x] T9: Mobile pager + touch (overlap root-caused: vendor auto-rows-fr grid; fixed via contents pass-through + wrappers; 4/4 mobile + deferred MS cases green; vendor sensors fine as shipped; patches 0)
- [x] T13: Modal subtask reorder controls in TaskFormModal (CP0 addition; discovery: ?task= opens TaskPanel, not the modal)
- [x] T13b: Same controls in TaskPanel (board-adjacent path; + missing position sort fixed; canEdit-gated)
- [x] Phase 2 review-fix batch: B1 liveColumns leak (red→green proven), M2 filter-aware column append (FA-5 rows + tests, 33/33), M3 modal arrow gating, M4 drag-overlay treatment, minors m1–m6/n1/n4

### CP2 — spike verdict
- [x] Measurements recorded (2026-07-27): vendor patches **0** (Gantt precedent 3); Solvro-owned runtime **1,363** vs old **1,182** (+181; R1 raw-LOC win did NOT materialize — essential-complexity isolation did: mapper+adapter 314 pure lines under 33 unit tests, 949 test lines new, dnd physics vendor-owned); vendor 947 unpatched
- [ ] Dogfood window done (desktop + phone); R6 subtask-drag friction noted
- [ ] User go / adjust / fall back

## Phase 3 — Verification & cutover
- [x] T10: e2e augmentation (21 cases green ×2 consecutive runs, zero flaky; G1–G10 + cross-view parity + modal paths via customer-scoped /tasks; RG-4 satisfied by pre-existing backend coverage; M2 refined: append signal defers to committed arrangement, 36/36 unit; findings for T12: vendor keyboard-DnD a11y gap, unpaginated /users, /tasks 200-row window, test-DB pollution)
- [x] T11: Cutover (route flip; old board deleted via wrapper replacement; KANBAN_ROUTE→kanban; solvro-qa R4 checks added; FULL gate set green: typechecks, 36/36 FE unit, 40/40 BE on fresh DB, full e2e suite minus pwa)
- [x] T12: Docs sync via solvro-docs-keeper (CLAUDE.md Kanban bullet + testing caveat iii; 7 findings filed in ISSUES.md; CHANGELOG trail verified; DESIGN/CONFIGURATION no-change confirmed)

### CP3 — complete
- [x] Full gates green (typechecks, 36/36 FE + 40/40 BE vitest on fresh DB, full e2e suite minus pwa — T11 gate run)
- [x] PR → `develop`, assigned `alfi-rajasyah` — https://github.com/alfi-rajasyah/solvro/pull/77 (commit 114a069, user-approved at CP3)
