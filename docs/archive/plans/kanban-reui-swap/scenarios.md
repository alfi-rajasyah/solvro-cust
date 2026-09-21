# Kanban → ReUI Scenario Table

> Task T1 of `docs/plans/kanban-reui-swap/plan.md`. Mined from
> `frontend/src/pages/views/ProjectKanban.tsx` (lines 48–130 collision rules,
> 192–340 global-order drop math, 381–426 subtask drops — "the old file is the
> spec", risk R2 in `docs/ideas/kanban-reui-swap.md`) plus
> `backend/src/lib/taskOrdering.ts`'s `insertAt` contract.

**This table is binding on T5** (`kanban-v2/commitMapper.ts` unit tests — every
row below becomes a test case written *before* the mapper implementation) **and
on T10** (`e2e/tests/kanban-dnd.spec.ts` augmentation — every row is a
candidate e2e case, gated by T2's coverage audit which classifies each row
covered/gap/obsolete against the current spec).

**Position-semantics rule (one sentence):** a drop's `position` is the index at
which the dragged task is inserted into its target sibling list **after that
task has been removed from the list** — i.e. index into the *moved-excluded*
global top-level order, exactly as `taskOrdering.ts`'s `insertAt` computes it
(others = every sibling except the moved task, ordered by `position` then
`id`; `requestedPosition` clamped to `[0, others.length]`; `undefined` = append).

Every "Expected request" cell below is the literal body `ProjectKanban.tsx`
sends via `updateTask.mutate({ id, patch })` — i.e. what T5's mapper must
reproduce, not the final DB row order (which the Notes column derives as a
cross-check, per T1's acceptance criteria, but is not itself the mapper's
output contract).

---

## Reference fixture

One project, three columns. Top-level tasks (`parentTaskId: null`), in the
single global order shared by List/Kanban/Gantt (`position` ascending):

| id | title | status | position |
|----|-------|--------|----------|
| 1 | A | TODO | 0 |
| 2 | B | TODO | 1 |
| 3 | C | TODO | 2 |
| 4 | D | IN_PROGRESS | 3 |
| 5 | E | DONE | 4 |

Subtasks of A (id 1):

| id | title | parentTaskId | position |
|----|-------|---------------|----------|
| 6 | S1 | 1 | 0 |
| 7 | S2 | 1 | 1 |

Derived views used throughout (`ProjectKanban.tsx:204-217`):

- `globalOrdered` / `topLevelAll` sorted: `[A(1), B(2), C(3), D(4), E(5)]`
- `groupedAll` (unfiltered, per status): `TODO: [A,B,C]`, `IN_PROGRESS: [D]`, `DONE: [E]`

**Fixture variant EC ("empty column")** — used only for the empty-column rows
(CC-3, MS-3): identical to the reference fixture but task D does not exist —
`[A(1,TODO,0), B(2,TODO,1), C(3,TODO,2), E(5,DONE,3)]`, so `IN_PROGRESS` has
zero tasks (`groupedAll.IN_PROGRESS === []`).

All PATCH bodies below are shown as the request body only; the endpoint is
always `PATCH /tasks/{id}` where `{id}` is the dragged task's id from the
tables above.

---

## 1. Card drops — same column

| ID | Given (fixture + filter) | Gesture | Expected request | Notes / cross-check | Source |
|----|---------------------------|---------|-------------------|----------------------|--------|
| SC-1 | Reference fixture, no filter | Drag **C** onto card **A** (drop on card above) | `{ status: "TODO", position: 0 }` | `computeCardDrop`: `overTask=A`, `idx = globalOrdered.findIndex(A) = 0` (moved-**inclusive** index — C is still in the list). Backend cross-check: `others` (excl. C) = `[A,B,D,E]` → clamp `min(0,4)=0` → insert C at 0 → final `[C,A,B,D,E]`, C now lands before A. | `ProjectKanban.tsx:321-338` |
| SC-2 | Reference fixture, no filter | Drag **B** onto card **C** (drop on card below, one slot down) | `{ status: "TODO", position: 2 }` | **The must-not-no-op case.** `idx = globalOrdered.findIndex(C) = 2` (inclusive — B still in the list at its old slot). Backend: `others` (excl. B) = `[A,C,D,E]`, clamp `min(2,4)=2` → insert B at 2 → final `[A,C,B,D,E]` — B correctly moves past C. **If `idx` were computed on the moved-*excluded* list instead** (`[A,C,D,E].findIndex(C)=1`), the backend would clamp to 1 and B would land back at its *own current* position 1 — a silent no-op. This asymmetry is deliberate. | `ProjectKanban.tsx:324-332` (comment names this exact hazard) |
| SC-3 | Reference fixture | Pick up **B**, release with pointer still inside B's original card rect (no real movement) | **NO REQUEST** | `boardCollisionDetection` returns `[]` when the pointer is inside `active.rect.current.initial` (line 111-124) → `over` is `null` in `onDragEnd` → `if (!over) return;` (line 348) fires before `computeCardDrop` is ever called. | `ProjectKanban.tsx:106-124`, `342-348` |
| SC-4 | Reference fixture | Drag **B** a short distance; collision resolves back to B's own sortable id | **NO REQUEST** | `if (activeId === overId) return;` (line 351). Note: `boardCollisionDetection` already filters the active id out of every candidate list (line 101), so this state is defensive/likely unreachable via the current collision detection — flagged in the report as a finding, not resolved here. | `ProjectKanban.tsx:99-104`, `351` |
| SC-5 | Reference fixture, no filter | Drag **B**; `over` resolves to subtask row `subtask:6` (S1, child of A) — the documented keyboard-sensor safety-net path, since `boardCollisionDetection` normally filters subtask droppables out of card drags | `{ status: "TODO", position: 0 }` | `isSubtaskId(overId)` → `overSub = S1`, `parentTaskId = 1` → `effectiveOverId = "card:1"` (A) → falls through to the card branch: `idx = globalOrdered.findIndex(A) = 0`. Defensive edge case noted in the same block: if the resolved subtask had `parentTaskId === null` (shouldn't happen) or didn't exist, `computeCardDrop` returns `null` → `if (!drop) return;` in `handleDragEnd` → NO REQUEST. | `ProjectKanban.tsx:309-319`, `354-355` |

## 2. Card drops — cross column

| ID | Given (fixture + filter) | Gesture | Expected request | Notes / cross-check | Source |
|----|---------------------------|---------|-------------------|----------------------|--------|
| CC-1 | Reference fixture, no filter | Drag **D** (IN_PROGRESS) onto card **B** (TODO) | `{ status: "TODO", position: 1 }` | `idx = globalOrdered.findIndex(B) = 1`. Backend: `others` (excl. D) = `[A,B,C,E]`, clamp `min(1,4)=1` → insert D at 1 → final `[A,D,B,C,E]` — D lands before B, status now TODO. | `ProjectKanban.tsx:321-338` |
| CC-2 | Reference fixture, no filter | Drag **E** (DONE) onto the **TODO** column body (not onto a card) | `{ status: "TODO", position: 3 }` | `columnEndPosition("TODO", excludeId=5)`: `colCards = groupedAll.TODO = [A,B,C]` (E isn't in TODO, no filtering needed), `last = C`. `globalOthers = globalOrdered` minus E `= [A,B,C,D]`, `idx(C) = 2` → `position = 2+1 = 3`. Backend: `others` (excl. E) `= [A,B,C,D]`, clamp `min(3,4)=3` → insert E at 3 → final `[A,B,C,E,D]` — E lands right after C (end of TODO), before D. | `ProjectKanban.tsx:257-284`, `293-298` |
| CC-3 | **Fixture EC** (no IN_PROGRESS tasks), no filter | Drag **C** onto the **IN_PROGRESS** column body (column is genuinely empty) | `{ status: "IN_PROGRESS" }` — **no `position` field** | `columnEndPosition`: `colCards = groupedAll.IN_PROGRESS.filter(id≠3) = []`, `last = undefined` → returns `undefined` → `computeCardDrop` returns `{ status }` only (no `position` key at all, not even `undefined` sent as a value). | `ProjectKanban.tsx:269-273`, `293-298`, `363-369` |

> **Amendment (Phase 1 review, 2026-07-27, orchestrator-accepted) — CC-1 WYSIWYG
> semantics delta.** This row's "Expected request" was mined from the *old*
> board, which always lands a card **after** its target on a downward
> card-to-card drop (moved-inclusive index — see the row's own Notes cell).
> ReUI's live-preview commit is arrangement-faithful instead: a cross-column
> drop onto a card can commit with the moved card on **either side** of the
> over-card depending on which half of the over-card the pointer released
> over — both are reachable engine outputs, not an old-board-vs-new-board
> discrepancy to reconcile. The orchestrator accepted this as the intended
> semantics for the new mapper (WYSIWYG is the point of live preview).
> `commitMapper.test.ts` now covers both arrangements for this gesture:
> - **CC-1** (moved lands **before** over-card, committed `TODO: [A, D, B, C]`)
>   → `{ status: "TODO", position: 1 }` (unchanged from the row above).
> - **CC-1b** (moved lands **after** over-card, committed `TODO: [A, B, D, C]`)
>   → `{ status: "TODO", position: 2 }`.
>
> T7 must capture real `onValueCommit` payloads for top-half vs bottom-half
> drops against the live vendored engine to confirm it actually produces both
> arrangements as expected (plan.md, Phase 1 Review Addenda #6).

## 3. Filter-active variants

All rows compute identically to the unfiltered case because `computeCardDrop`/
`columnEndPosition` always read `topLevelAll`/`groupedAll` (unfiltered) — never
`topLevel`/`grouped` (filtered, rendering-only). These rows exist to prove a
*hidden* card still correctly participates in (and is shifted by) the global
math, per `ProjectKanban.tsx:192-203`.

| ID | Given (fixture + filter) | Gesture | Expected request | Notes / cross-check | Source |
|----|---------------------------|---------|-------------------|----------------------|--------|
| FA-1 | Reference fixture; assignee filter hides **B** (id 2) — filtered TODO column visually shows only `[A, C]` adjacent | Drag **C** onto card **A** (reorder — B sits between them in the real, unfiltered order) | `{ status: "TODO", position: 0 }` | Identical computation to SC-1 (filter has zero effect on `computeCardDrop`'s inputs). Backend: `others` (excl. C) `= [A,B,D,E]` → insert C at 0 → final `[C,A,B,D,E]`. The hidden card B still shifts from position 1 → 2, even though the user never saw it move. | `ProjectKanban.tsx:192-203`, `321-338` |
| FA-2 | Reference fixture; assignee filter hides **C** (id 3) — invisible, sits between A and D in the real order | Drag **A** onto card **D** (cross-column, card-to-card) | `{ status: "IN_PROGRESS", position: 3 }` | `idx = globalOrdered.findIndex(D) = 3` (inclusive). Backend: `others` (excl. A) `= [B,C,D,E]`, clamp `min(3,4)=3` → insert A at 3 → final `[B,C,D,A,E]`. Hidden C correctly retains its slot ahead of D despite being invisible. | `ProjectKanban.tsx:192-203`, `321-338` |
| FA-3 | Reference fixture; assignee filter hides **D** (id 4) — the *only* IN_PROGRESS card, so the column visually looks empty to the filtered user | Drag **A** onto the **IN_PROGRESS** column body | `{ status: "IN_PROGRESS", position: 3 }` | `columnEndPosition` reads `groupedAll` (unfiltered), so `colCards = [D]` — **not** empty, even though the user's filtered view shows an empty column. `last = D`, `globalOthers` (excl. A) `= [B,C,D,E]`, `idx(D)=2` → `position=3`. Same final result as FA-2 by coincidence — both gestures correctly place A right after D; confirms the card-branch and column-branch agree when D is the last (only) IN_PROGRESS card. **This is the row that would catch a wrong-empty-column bug** if a reimplementation ever read the filtered `grouped` instead of `groupedAll` here. | `ProjectKanban.tsx:192-203`, `257-284`, `293-298` |
| FA-4 | Reference fixture; assignee filter hides **B** (id 2) | Drag **A** onto the **TODO** column body (same-column, filtered) | `{ status: "TODO", position: 2 }` | `colCards = groupedAll.TODO.filter(id≠1) = [B,C]`, `last=C`. `globalOthers` (excl. A) `= [B,C,D,E]`, `idx(C)=1` → `position=2`. Backend: insert A at clamp `min(2,4)=2` into `[B,C,D,E]` → final `[B,C,A,D,E]` — A moves to the end of TODO, hidden B correctly stays at the front. | `ProjectKanban.tsx:192-203`, `257-284` |
| FA-5 | Reference fixture; assignee filter hides **C** (id 3) | Drag **D** (IN_PROGRESS) onto the **TODO** column BODY (not onto a card) | `{ status: "TODO", position: 3 }` | See amendment below the table — requires an explicit `appendToStatus` column-append signal; naive committed-arrangement neighbor math would anchor on B (last VISIBLE card) and produce `position: 2`, landing D before the hidden true-last card C instead of after it. | `commitMapper.ts` (M2 fix) |
| FA-5-MS | Same fixture/filter as FA-5 | Open the move sheet for **D**, tap **To Do** | `{ status: "TODO", position: 3 }` | Move-sheet variant of FA-5 — see the same amendment; `buildColumnAppendCommit` synthesizes the identical explicit signal, reaching the same code path with the same result. | `commitMapper.ts` (M2 fix), `MobileMoveSheet.tsx` |

> **Amendment (Phase 2 review, 2026-07-27, orchestrator-accepted) — FA-5/FA-5-MS
> filter-active column-append bug + fix.** Reviewer finding M2: a column-body
> drop's position was being inferred from the committed (possibly filtered)
> arrangement's visible neighbors — the same neighbor-based math card-to-card
> drops correctly use — which is wrong specifically for column-*body* drops
> under an active filter. Fixture: A,B,C TODO / D IN_PROGRESS / E DONE, filter
> hides C. Dragging D onto the TODO column body commits a FILTERED TODO of
> `[A, B, D]` (C invisible), so D's committed predecessor is B, not C; a
> neighbor read would anchor on B and produce `{ status: "TODO", position: 2
> }`, silently landing D **before** the hidden C instead of after it (the
> true end, `position: 3`). Fix: `commitMapper.ts`'s `mapCommitToPatch` now
> takes an explicit `appendToStatus` signal (`KanbanCommitMetaLike.
> appendToStatus`) that, when it matches the drop's target status, bypasses
> committed-arrangement inference entirely and anchors on the UNFILTERED last
> member of that status instead (`columnAppendPosition`, factored out of
> `resolvePosition`'s own empty-neighbor fallback). `SolvroKanban.tsx` sets
> the signal for a real drag by checking whether `meta.event.over?.id`
> resolves to a `KANBAN_STATUSES` member (column id) rather than a card id;
> `buildColumnAppendCommit` (move sheet) sets it directly. Card-to-card drops
> never set this signal, so FA-1/FA-2/FA-2b/FA-4 (and all SC/CC rows) are
> unaffected and continue to resolve via `resolvePosition`'s neighbor-based
> math — confirmed by a dedicated mapper test with a deliberately mismatched
> `appendToStatus` on an FA-2-shaped input. `commitMapper.test.ts` covers
> FA-5 (drag-shaped meta) and FA-5-MS (move-sheet-shaped meta) as separate
> tests, both against the fixed mapper.
>
> **Amendment (T10, 2026-07-27) — signal alone is not sufficient; the
> committed arrangement must agree.** A real e2e run (`kanban-dnd.spec.ts`'s
> G9a) surfaced the gap in the amendment above: `meta.event.over?.id`
> resolving to a `KANBAN_STATUSES` member is *necessary* but not *sufficient*
> proof of a genuine column-body drop — dnd-kit's `rectIntersection` can
> resolve `over` to the column even while the live-preview arrangement shows
> the moved item inserted MID-column (a card-to-card "insert before"). The
> old unconditional `appendToStatus === targetStatus` check took the append
> branch anyway, computed a position equal to the moved card's own current
> slot, and the no-op guard silently swallowed it — nothing committed while
> the user watched the card visibly move (a WYSIWYG violation, not merely a
> wrong-position bug like the original M2 finding). Fix: `mapCommitToPatch`
> now additionally requires `meta.overIndex === targetColumn.length - 1`
> (the committed arrangement itself shows the moved item LAST in the target
> column) before honoring the signal — "the committed arrangement is the
> truth". FA-5/FA-5-MS above are unaffected (their fixtures already satisfy
> this — D lands last in both). New coverage in `commitMapper.test.ts`
> ("T10 (2026-07-27) M2 refinement" describe block): signal-set-but-
> arrangement-disagrees (neighbor math wins, the G9a shape), signal-set-and-
> arrangement-agrees (unchanged FA-5 behavior), and no-signal-with-a-hidden-
> true-last (neighbor math anchors on the visible predecessor — confirmed as
> correct WYSIWYG for a card-targeted drop, not a bug: append-to-true-end
> semantics are reserved for genuine column-space drops).

> **Amendment (Phase 1 review, 2026-07-27, orchestrator-accepted) — FA-2
> WYSIWYG semantics delta.** Same delta as CC-1's amendment above, under an
> active filter: FA-2's request was mined from the old board's
> moved-inclusive-index, always-lands-after behavior. ReUI's live-preview
> commit for this cross-column card-to-card gesture is arrangement-faithful
> and can land on either side of the over-card. `commitMapper.test.ts` now
> covers both arrangements:
> - **FA-2** (moved lands **after** over-card, committed
>   `IN_PROGRESS: [D, A]`) → `{ status: "IN_PROGRESS", position: 3 }`
>   (unchanged from the row above).
> - **FA-2b** (moved lands **before** over-card, committed
>   `IN_PROGRESS: [A, D]`) → `{ status: "IN_PROGRESS", position: 2 }`.
>
> Same T7 confirmation requirement as CC-1's amendment (plan.md, Phase 1
> Review Addenda #6).

## 4. No-op guards

| ID | Given | Gesture | Expected request | Notes / cross-check | Source |
|----|-------|---------|-------------------|----------------------|--------|
| NO-1 | Reference fixture | Drop a card back in its original slot | **NO REQUEST** | Cross-reference, not a new computation: two independent mechanisms both yield this — SC-3 (pointer-inside-original-slot → collision detection returns `[]` → `over === null`) and SC-4 (resolves to own id → `activeId === overId` guard). | `ProjectKanban.tsx:106-124`, `348`, `351` |
| NO-2 | Reference fixture, no filter | Drag **C** (already the last card in TODO) onto the **TODO** column body | **NO REQUEST** | `computeCardDrop` returns `{ status: "TODO", position: 2 }` (same math as CC-2: `columnEndPosition` excl. C → `last=B`, `globalOthers` excl. C `=[A,B,D,E]`, `idx(B)=1`→`position=2`) — but C's own current `position` is already `2` and `status` is already `TODO`, so the guard at lines 358-362 (`moved.status===drop.status && moved.position===drop.position`) fires and swallows it. **Provable non-triviality**: for the card-to-card branch (`isCardId(overId)`), this guard can *never* fire — `drop.position` is always the over-card's own distinct index in the same list `moved.position` indexes into, and two distinct cards can't share an index — so a genuine "unchanged" no-op is *only* reachable through the column-body/empty-column branch, as demonstrated here. Worth knowing for T5: the mapper's no-op guard is doing real work only on the append-to-end path. | `ProjectKanban.tsx:342-343`, `358-362` |
| NO-3 | Reference fixture | Start dragging **B**, press **Escape** mid-drag | **NO REQUEST** | `handleDragEnd` (the only call site of `updateTask.mutate`) is wired only to `DndContext`'s `onDragEnd` prop; there is **no `onDragCancel` prop wired** (`DndContext` at lines 618-623 only sets `onDragStart`/`onDragEnd`). No PATCH fires either way. **Flagged as an ambiguity** (see report): without `onDragCancel`, the local `activeCard`/`activeSubtask` React state set in `handleDragStart` (line 142-143) is never cleared on cancel, so the `DragOverlay` ghost card may stay stuck on screen after dnd-kit itself has reset — a plausible latent bug in the old file, not something to carry into the new mapper/adapter. | `ProjectKanban.tsx:142-143`, `245-255`, `342-348`, `618-623` |

## 5. Mobile move sheet

`MobileMoveSheet.onMove` reuses `computeCardDrop`'s column-append math directly
(`ProjectKanban.tsx:686-708`) rather than re-deriving it.

| ID | Given | Gesture | Expected request | Notes / cross-check | Source |
|----|-------|---------|-------------------|----------------------|--------|
| MS-1 | Reference fixture | Open the move sheet for **C**, tap **In Progress** | `{ status: "IN_PROGRESS", position: 3 }` | `drop = computeCardDrop(3, "column:IN_PROGRESS")`. `colCards = groupedAll.IN_PROGRESS.filter(id≠3) = [D]`, `last=D`. `globalOthers` excl. C `= [A,B,D,E]`, `idx(D)=2` → `position=3`. Identical math to a column-body drop (CC-2's pattern). | `ProjectKanban.tsx:686-708` |
| MS-2 | Reference fixture | Open the move sheet for **C**, tap **To Do** (C's current status) | **NO REQUEST** | `onMove`'s own guard: `if (status !== mobileSheetTask.status)` — for the current-status button this is `false`, so `computeCardDrop` is never even called; only `setMobileSheetTask(null)` runs. This is a sheet-level guard, distinct from `computeCardDrop`'s internal no-op guard (NO-2). | `ProjectKanban.tsx:690-705` |
| MS-3 | **Fixture EC** (no IN_PROGRESS tasks) | Open the move sheet for **C**, tap **In Progress** (empty column) | `{ status: "IN_PROGRESS" }` — no `position` field | Same empty-column path as CC-3, reached through the sheet instead of a drag: `columnEndPosition` returns `undefined` → status-only patch. | `ProjectKanban.tsx:269-273`, `686-703` |

## 6. Retired gestures → modal path

Subtask dragging (reorder within parent, re-parent onto a card, promote via
column background) is retired from the board per Architecture Decision 2/8;
the inline checklist keeps only its DONE/not-DONE toggle
(`ProjectKanban.tsx:451-454`, ported to `kanban-v2/cards.tsx` unchanged). The
sole replacement surface is `TaskFormModal.tsx`'s **Parent** field
(`TaskFormModal.tsx:356-373`) — a `<select>` restricted to top-level tasks in
the same project (`possibleParents`, line 126-128), submitted as part of a
full-form `PATCH` that **never includes a `position` key** (the patch object
literal at `TaskFormModal.tsx:153-167`/`169-180` hardcodes its field list and
`position` isn't one of them) — so every modal-driven parent change appends to
the end of its target sibling list per `insertAt`'s `undefined` handling.
`TaskFormModal`'s Subtasks panel (lines 422-454) renders **only** a checkbox
per subtask; there is no reorder or re-parent control there.

| ID | Given | Old gesture (RETIRED) | Modal-path equivalent + expected request | Notes | Source |
|----|-------|------------------------|-------------------------------------------|-------|--------|
| RG-1 | Reference fixture | Drag **S2** onto **S1** within A's subtask list (reorder within same parent) | **NO MODAL EQUIVALENT.** `TaskFormModal`'s subtask list is checkbox-only (lines 422-454); there is no UI path to change subtask order after retirement. **Flagged as a gap**, not resolved here — see report. | Old behavior was `{ position: 0 }` (or `{ parentTaskId, position }` if crossing parents) via `submitSubtaskPatch`. | `ProjectKanban.tsx:384-397`; `TaskFormModal.tsx:422-454` |
| RG-2 | Reference fixture | Drag **S1** (child of A) onto card **B** (re-parent onto a different card, appended at end of B's — currently empty — subtask list) | Open S1's edit modal, set **Parent → B**. Ordering-relevant field: `{ parentTaskId: 2 }` (no `position`). Backend: `closeGap` on A's subtask list (S2 → position 0), then `insertAt` on B's subtask list with `requestedPosition=undefined` → `others.length=0` → S1 becomes B's subtask at position 0. | Same *destination* as the old gesture (end of B's subtask list), reached by an edit-and-save flow instead of a single drag. | `ProjectKanban.tsx:400-408`; `TaskFormModal.tsx:147`, `153-167`, `356-373` |
| RG-3 | Reference fixture | Drag **S1** onto the **TODO** column background (promote to top-level, appended at end of TODO in the global order) | Open S1's edit modal, set **Parent → "— Top level —"**. Ordering-relevant field: `{ parentTaskId: null }` (no `position`). Backend: `closeGap` on A's subtasks (S2 → position 0), then `insertAt` on the top-level list with `requestedPosition=undefined` → `others.length=5` (A,B,C,D,E) → S1 appended at global position 5, after E. | Matches Architecture Decision 8's own framing verbatim: promotion appends at global end because `position` is omitted. | `ProjectKanban.tsx:410-426`; `TaskFormModal.tsx:147`, `153-167` |
| RG-4 | Reference fixture | *(no direct old-gesture analog — `invalid_parent` was a drag-drop error case in `submitSubtaskPatch`)* | Edit any task's modal, attempt to set its Parent to a task id that no longer exists (only realistically reachable via a stale `possibleParents` option after a concurrent delete — the `<select>` already excludes self and non-top-level tasks, so `taskId===parentTaskId` and cross-project cases aren't reachable through this UI at all). Backend throws `invalid_parent`; modal's `catch` sets `error = err.message` and renders it inline (`TaskFormModal.tsx:183-184`, `456-464`); **no mutation applied**, drawer stays open. | **Flagged as an ambiguity**: this row is only reachable via a race condition, not a deterministic UI action — worth a call on whether T10 should test it through the UI at all or hit the API directly. Old board's equivalent error UX was a distinct `dropError` banner with custom copy (`ProjectKanban.tsx:432-441`); the modal path instead shows the raw backend `message` — a genuine UX difference, not just a relocation. | `backend/src/lib/taskOrdering.ts:117-133`; `ProjectKanban.tsx:432-441`; `TaskFormModal.tsx:183-184` |
| RG-5 | Reference fixture | *(no direct old-gesture analog)* | Edit **A** (has subtasks S1, S2), set its Parent → **B**. Backend `assertValidParent` finds B has no parent (passes the depth-1 check for B) but then finds `subtaskCount = 2 > 0` for A itself → throws `max_depth_exceeded` ("Cannot give a parent to a task that already has subtasks"). Modal shows the message inline; **no mutation applied**. | This is the *reachable* form of `max_depth_exceeded` through this UI — the other form (`parent.parentTaskId !== null`, i.e. nesting two levels) is structurally prevented by `possibleParents` only ever listing top-level tasks. | `backend/src/lib/taskOrdering.ts:116-149`; `TaskFormModal.tsx:126-128`, `183-184` |

## 7. Collision-detection provenance

Not gesture rows — this documents why `boardCollisionDetection`
(`ProjectKanban.tsx:80-130`) exists and what happens to its reasons once
subtask drag surfaces are retired from the board.

**Failure mode 1 — card over a subtask region resolves to the subtask
droppable** (`ProjectKanban.tsx:82-85`). A dragged *card* whose pointer/rect
overlaps another card's subtask checklist rows would, under bare
`closestCorners`, resolve `over` to a `subtask:*` id instead of the enclosing
`card:*` id — code that only recognised card-drop and subtask-drop shapes
would silently no-op. The fix filters every `subtask:*` droppable out of the
candidate list whenever the active drag is a card (`line 102`). **This mode is
genuinely retired-moot**: once subtask drag surfaces are removed from the
board (Architecture Decision 2/8), there are no `subtask:*` droppables
registered at all — the hazard has no droppable left to resolve to, not merely
a filtered one.

**Failure mode 2 — a tall card dragged a short distance resolves to its own
ghost rect** (`ProjectKanban.tsx:86-89`). Because each sortable card is
simultaneously a draggable *and* a droppable at its own original slot, a short
drag can resolve `over.id === active.id`. The fix filters the active id out of
every candidate list (`line 101`) — this is generic `@dnd-kit/sortable`
self-collision, **not specific to subtasks in any way**: it would occur
identically on a subtask-free, card-only board. This mode does **not** become
moot when subtask drag is retired — its ReUI-era analog is explicitly named in
`docs/ideas/kanban-reui-swap.md`'s risk R2 as a live hazard ("the
drop-back-in-place no-op... ReUI may read the same gesture as append to column
end and fire a spurious PATCH"), which is exactly why the mapper's own no-op
guard (Architecture Decision 3, `previousValue` deep-equal → `null`) exists as
its replacement mitigation, at the mapper layer rather than the
collision-detection layer.

**Contradiction flagged for the orchestrator** (not resolved here): the idea
doc's Context section states "*both* documented failure modes... are
subtask-related" (`docs/ideas/kanban-reui-swap.md:31-33`), but per the code
above only failure mode 1 is actually subtask-specific — failure mode 2 is a
generic sortable self-collision that persists as a risk (R2) independent of
the subtask-drag retirement. See report.

---

## e2e Coverage Audit (T2)

> Task T2 of `docs/plans/kanban-reui-swap/plan.md`. Matrices
> `e2e/tests/kanban-dnd.spec.ts`'s 10 existing cases (7 desktop-mouse in
> `kanban drag & drop — desktop (mouse)`, 3 mobile-touch in `kanban drag &
> drop — mobile (touch)`) against every row in the table above. Cross-checked
> against `e2e/fixtures/test.ts` (helpers: `loginViaUi`, `openKanban`,
> `gripFor`, `center`, `mouseDrag`, `touchDrag`, `apiBase`), `e2e/fixtures/
> seed.ts` (`seedFixture`/`getTasks`/`setWipLimits`; seeded project = Alpha/
> Beta/Gamma (TODO), Delta (IN_PROGRESS), Sub one/Sub two (children of
> Alpha) — **no DONE task is seeded**, so DONE starts empty every run), and
> `e2e/tests/list-dnd.spec.ts` (skimmed for cross-view awareness only).

### 1. Classification table

Legend: **Covered** = an existing case already exercises this row's exact
gesture/assertion shape. **GAP** = no existing case reaches this row; T10
must add one (or explicitly redirect it elsewhere — see §4). **OBSOLETE-
GESTURE** = the row's *old* drag gesture is retired per Architecture Decision
2/8; only the three existing subtask-drag cases in kanban-dnd.spec.ts map
here, and their behavioral outcome is re-covered through the modal path
(§6/RG rows), not through a rewritten drag.

| ID | Classification | Covered-by / rationale |
|----|-----------------|--------------------------|
| SC-1 | **Covered** | `reorder within column: Gamma onto Alpha -> Gamma before Alpha` — same gesture shape (drag onto a card, drop above it), same fixture roles (Gamma≈C, Alpha≈A). |
| SC-2 | **GAP** | No existing case drags a card **down** one slot onto the card immediately below it. This is explicitly "the must-not-no-op case" in the table (inclusive-index asymmetry) — the highest-value gap here, not merely a coverage nicety. |
| SC-3 | **GAP** | No existing case drops a card back in its own original slot and asserts request absence. Matches the plan's known-expected "drop-in-place no-op" gap. |
| SC-4 | **GAP** | No existing case forces `activeId === overId`. The scenario table itself flags this path as "defensive/likely unreachable via the current collision detection" — see §3 note on G3 for why one case can cover the *observable* outcome of SC-3+SC-4 without isolating which internal guard fired. |
| SC-5 | **GAP** | No existing case forces a card drag to resolve onto a subtask droppable (keyboard-sensor safety-net path). Likely **inapplicable** in the ReUI board once subtask drag surfaces are removed (§7's failure-mode-1 is "retired-moot" for the same reason) — flag for re-evaluation at T7 rather than building blind. |
| CC-1 | **GAP** | No existing case does a card-to-card **cross-column** drop (only column-body cross-column exists, CC-2). This is the plan's named "on-card insertion drop" gap. |
| CC-2 | **Covered** | `cross-column drag: Beta -> In Progress column` — column-body drop into a non-empty target column (Delta already present), same math shape as CC-2 (append after existing last card). |
| CC-3 | **GAP** | No existing case targets a genuinely empty column via drag. Fixture note: DONE is empty by default in the current seed — no new fixture needed, just target DONE instead of the table's IN_PROGRESS/EC variant. |
| FA-1 | **GAP** | No existing case touches the filter popover at all. |
| FA-2 | **GAP** | Same. |
| FA-3 | **GAP** | Same — this is also the row the table calls out as the one that "would catch a wrong-empty-column bug," i.e. highest-value FA row to prioritize if only one is written. |
| FA-4 | **GAP** | Same. |
| NO-1 | **GAP** | No existing case asserts request absence on a drop-in-original-slot gesture (cross-references SC-3/SC-4, same underlying gap). |
| NO-2 | **GAP** | No existing case drags the already-last card onto its own column body and asserts no request. |
| NO-3 | **GAP** | No existing case starts a drag and presses Escape. |
| MS-1 | **GAP** | No existing case opens the move sheet against a **non-empty** target column. The one existing move-sheet case (mobile action-sheet test) targets DONE, which is empty — that's MS-3's shape, not MS-1's. |
| MS-2 | **GAP** | No existing case taps the move sheet's button for the card's own current status. |
| MS-3 | **GAP** (existing case is a weak partial analog) | `mobile action sheet: card menu moves card to Done` reaches the same empty-column-via-move-sheet code path (DONE is empty pre-test) but only asserts final state (`status`, `parentTaskId`) via API readback — it cannot distinguish "no `position` key sent" from "a `position` key was sent and happened to compute the same append." That distinction is MS-3's actual acceptance bar and requires request-body capture, which no existing case does. Classified GAP, not Covered, for that reason. |
| RG-1 | **OBSOLETE-GESTURE** | `subtask reorder: Sub two onto Sub one -> Sub two pos 0`. Per the table's own RG-1 row, there is **no modal equivalent** — nothing to rewrite to. |
| RG-2 | **OBSOLETE-GESTURE** | `subtask re-parent: Sub one onto Delta card`. Modal-path replacement exists (Parent field). |
| RG-3 | **OBSOLETE-GESTURE** | `subtask promote: Sub two -> top-level DONE`. Modal-path replacement exists (Parent → "— Top level —"); this case carries the load-bearing GLOBAL-order assertion (see §2). |
| RG-4 | **GAP** | No old-gesture analog and no current case. Per the table's own row and Special Note (a) below, recommend NOT a UI e2e case at all. |
| RG-5 | **GAP** | No old-gesture analog and no current case. Unlike RG-4, this is deterministically reachable through the UI (no race needed) — good e2e candidate. |

**Counts: 2 Covered, 18 GAP, 3 OBSOLETE-GESTURE — 23/23 rows classified, none unclassified.**

### 2. Existing-case disposition

All ten cases live in `e2e/tests/kanban-dnd.spec.ts`. T10's own description
already mandates "a route constant targeting `/kanban2`" for every surviving
case, so that mechanical change is implied wherever the disposition is
"keep" and not called out per-row again below.

| # | Case name | Project | Disposition | Notes |
|---|-----------|---------|--------------|-------|
| 1 | `reorder within column: Gamma onto Alpha -> Gamma before Alpha` | desktop | keep with route-constant change only | Covers SC-1. |
| 2 | `cross-column drag: Beta -> In Progress column` | desktop | keep with route-constant change only | Covers CC-2. |
| 3 | `subtask reorder: Sub two onto Sub one -> Sub two pos 0` | desktop | **drop** (reason: RG-1 has no modal equivalent — there is no replacement UI surface to rewrite this to; `TaskFormModal`'s subtask panel is checkbox-only) | The gap this leaves is already flagged by the scenario table itself (RG-1), not newly discovered here. |
| 4 | `subtask re-parent: Sub one onto Delta card` | desktop | **rewrite to modal path** | Open Sub one's edit modal, set Parent → Delta, assert `parentTaskId === delta.id` and that it lands at the end of Delta's (currently empty) subtask list, per RG-2. |
| 5 | `subtask promote: Sub two -> top-level DONE` | desktop | **rewrite to modal path** | Open Sub two's edit modal, set Parent → "— Top level —" (and DONE status via whatever the modal's status control is, to preserve the DONE-column assertion). **Must preserve the load-bearing GLOBAL-order assertion** — the current test's final block (`globalTitles[globalTitles.length - 1]).toBe("Sub two")`) is what actually pins the unified-task-ordering fix (append-at-global-end, not front); the rewrite must keep an equivalent assertion, since `parentTaskId: null` submitted with no `position` key goes through the exact same `insertAt(undefined, ...)` global-append path per RG-3. |
| 6 | `WIP badge shows over-limit count in TODO column` | desktop | keep with route-constant change only | Not a drag gesture, doesn't map to any T1 row — pure WIP-chip rendering check. Still valid on kanban-v2 per T6's own acceptance criterion ("WIP over-limit chip shows amber"). |
| 7 | `no page errors during drag interactions` | desktop | keep with route-constant change only | General regression smoke, not a scenario-row assertion; independent value from #1. |
| 8 | `touch reorder within TODO: drag Alpha to column background below all cards -> appended to end` | mobile | keep with route-constant change only | Doesn't map 1:1 to any T1 row — the table has no explicit "same-column, column-body drop, source not already last" row (section 1 is card-to-card only; section 2's column-body rows are all cross-column). Still legitimate coverage of the append-to-end column-body math on touch; not counted toward the 23-row classification above. |
| 9 | `mobile action sheet: card menu moves card to Done` | mobile | keep with route-constant change only, **and** treat as insufficient on its own to close MS-3 | See MS-3 classification above — needs the request-body-capture strengthening from gap case G6 (§3) to actually prove the "no `position` key" contract. |
| 10 | `no page errors during mobile drag/action-sheet interactions` | mobile | keep with route-constant change only | General regression smoke, mirrors #7. |

### 3. Gap list for T10

Each gap case below names the scenario IDs it closes, its project, its
assertion style, and any fixture/helper work needed beyond what
`e2e/fixtures/test.ts` / `seed.ts` currently expose.

| # | New case | Covers | Project | Assertion style | Fixture/helper prerequisites |
|---|----------|--------|---------|-------------------|-------------------------------|
| G1 | Card-to-card cross-column drop: drag Delta onto Beta | CC-1 | desktop | API readback (`getTasks`), status flip + relative order, same idiom as case #1 | None — Beta/Delta already exist in the seed fixture in the roles the table's B/D play. |
| G2 | Same-column downward one-slot drop: drag Beta (or Alpha) onto the card immediately below it | SC-2 | desktop | API readback; explicitly assert the dragged card's new index is **greater** than its pre-drag index and lands after the target (not merely "somewhere adjacent") — this is the assertion that actually distinguishes the inclusive-index fix from the no-op regression the table warns about | None. |
| G3 | Drop-in-place fires no request | SC-3, NO-1 (SC-4 observationally, see caveat) | desktop | Request-**absence**: `e2e/fixtures/test.ts` has no such helper today — needs a `page.on('request')` filter for `PATCH /tasks/:id` (or `page.waitForRequest(pattern, { timeout }).catch(() => null)` and assert `null`) held open for the drag's duration | New shared helper in `fixtures/test.ts` (e.g. `expectNoTaskPatch(page, fn)`). Caveat: this single case can only prove the *user-visible* outcome (no request); the table itself says SC-4's specific guard (`activeId === overId`) is likely unreachable via real pointer input, so don't budget a second case trying to isolate it. |
| G4 | Already-last card dropped onto own column body | NO-2 | desktop | Same request-absence helper as G3 | Reuses G3's helper. |
| G5 | Escape mid-drag cancels with no request | NO-3 | desktop | Request-absence helper (G3) + assert the drag overlay/ghost is gone after Escape | Reuses G3's helper; needs an inline `page.mouse.down()` → move → `page.keyboard.press("Escape")` → `page.mouse.up()` sequence (no existing helper does this — `mouseDrag` always ends in a real `mouse.up()` at the destination). **Caveat**: write this against the *new* board's actual cancel behavior once T7 lands — the old file's specific gap (no `onDragCancel` wired) is an old-board implementation detail, and Architecture Decision 5 explicitly turns on `restoreOnCancel` for the new adapter, so the old test's assumptions shouldn't be ported blind. |
| G6 | Empty-column drop omits `position`: (a) drag a card onto DONE's column body, (b) move-sheet → tap "Done" | CC-3, MS-3 | desktop (a), mobile (b) | Request-**body capture**, not readback alone — final DB state can't distinguish "no `position` key sent" from "a `position` was sent and happened to compute the same append," since DONE starts empty either way. Needs a helper that captures the outgoing `PATCH /tasks/:id` JSON body and asserts `"position" in body === false` | New shared helper (e.g. `captureTaskPatch(page)` returning the parsed body). No new task-fixture work — DONE is empty in the seed by default, satisfying fixture-EC without any change to `seed.ts`. |
| G7 | Move sheet against a non-empty target column: open sheet for Gamma, tap "In Progress" (Delta present) | MS-1 | mobile | Request-body capture (asserts both `status` and `position` present) or API readback (order after Delta) — either suffices since this row isn't a no-`position` case | None. |
| G8 | Move sheet: tap the card's own current status | MS-2 | mobile | Request-absence helper (G3) | Reuses G3's helper. |
| G9 | Filter-active drops: reorder + cross-column + column-body under an active filter | FA-1, FA-2, FA-3, FA-4 | desktop | API readback, same idiom as G1/G2, but performed with the filter popover open and a card hidden — assert the hidden card's global position still shifts correctly even though it's never visible on screen | **Needs new fixture/helper work.** The table's FA rows all specify hiding a card via the **assignee** filter, and `seed.ts` today only ever logs in as the single seeded admin/QA user — there is no helper to create a second user or assign a task to anyone else. `POST /admin/users` exists (`backend/src/routes/admin.ts:85`, `requireAdmin`) and is reachable with the same admin token `seedFixture` already holds, so a new helper (e.g. `createSecondUser` + a task `assignedToId` PATCH) is buildable but is new fixture surface, not a reuse of existing helpers. **Cheaper alternative**: substitute the **priority** filter instead — `Task.priority` is settable directly on creation via the existing `mk` POST helper (`backend/src/routes/tasks.ts` create schema accepts `priority`), needs no second user, and `computeCardDrop`/`columnEndPosition` are filter-field-agnostic (both assignee and priority filtering only narrow `topLevel`/`grouped`, never the `topLevelAll`/`groupedAll` the math actually reads), so a priority-filter case is behaviorally equivalent proof of the same code path. Flagging both options rather than picking one — the table was authored specifically around assignee filtering, so silently swapping to priority is a deviation worth a human call before T10 commits to it. |
| G10 | Modal error path: give Alpha (has subtasks) a Parent | RG-5 | desktop | API readback (Alpha's `parentTaskId` unchanged after the attempt) + UI assertion that the inline error text renders in the modal | New helper needed: no existing fixture helper opens a task's edit modal or drives its Parent `<select>`; `gripFor`/`openKanban` are drag-oriented only. A small `openTaskModal(page, title)` / `setParentField(page, value)` pair would be reused by G10 and by the RG-2/RG-3 modal-path rewrites in §2. |

RG-4 is intentionally **not** in this list — see Special Note (a).

### 4. Special notes

**(a) RG-4 (`invalid_parent`) — recommend backend vitest, not a UI e2e case.**
The scenario table's own RG-4 row says this is "only reachable via a race
condition, not a deterministic UI action" — `TaskFormModal`'s `possibleParents`
`<select>` already excludes self and non-top-level tasks, so the only way to
submit a `parentTaskId` that fails `invalid_parent` server-side is a stale
option surviving a concurrent delete between page load and submit, which
Playwright cannot deterministically force through normal UI interaction
without reaching into internal component state or mocking the delete race.
Per T1's report, this validation path (`backend/src/lib/taskOrdering.ts:117-
133`) is better proven directly against the backend Vitest suite (`backend/
test/`) by calling the ordering/parent-validation logic with a `parentTaskId`
that doesn't exist, independent of any UI. T10 should skip writing a UI case
for RG-4 and instead confirm (or file, if missing) backend-level coverage of
`invalid_parent`.

**(b) Cross-view parity (R3).** One new case: after any Kanban drag that
reorders the global top-level order (cheapest: append it as a follow-on
assertion inside G1 or G2 rather than a standalone drag test), navigate to
`/projects/:id/list` and assert the same order via `getTasks` +
`list-dnd.spec.ts`'s `topLevelSorted` helper (`e2e/tests/list-dnd.spec.ts:27-
31`) — no new List-side UI interaction needed, since this is proving
*read-side* parity (both views render the same `position`-ordered list), not
that dragging in Kanban and dragging in List behave identically. Cheap
because it's pure API-readback reusing an existing sort helper; the only new
work is either exporting `topLevelSorted`/`byTitle` from `list-dnd.spec.ts`
into a shared module or duplicating the ~5-line function into
`kanban-dnd.spec.ts` (both files already duplicate `byTitle`, so precedent
exists for the latter).
