# Unified Manual Task Ordering (drag that sticks)

Refined 2026-07-22 from a three-part bug report: List drags snap back
("always auto list on itself"), Kanban arrangements keep getting disturbed,
and Gantt rows cannot be reordered at all.

## Problem

How might we give the TAM one durable, manual task order that every view
respects — so a drag lands where it's dropped and stays there?

## Diagnosis

The three symptoms are one architectural mismatch plus one missing feature:

- **The ordering key doesn't match what the user sees.** `Task.position`
  for top-level tasks is dense within a sibling list keyed
  `(projectId, parentTaskId=null, status)` — see `siblingWhere` in
  `backend/src/lib/taskOrdering.ts`. The *Kanban column* is therefore the
  only display grouping the backend can actually order.
- **List** (`frontend/src/pages/views/ProjectList.tsx`) displays tasks
  grouped by *section*, sorted by `(position, id)` as an admitted "stable
  proxy" (comment at `ProjectList.tsx:135-139`). The visible order is an
  interleave of three independent status-scoped sequences. The drag handler
  (`ProjectList.tsx:310-322`) computes the drop index among *same-status*
  siblings only — placing an Active task between two To-do tasks is
  impossible by design. Drops silently no-op or land elsewhere.
- **Kanban** (`frontend/src/pages/views/ProjectKanban.tsx`) is the one view
  whose drop math is index-correct (`computeCardDrop`, `:274-291`), but a
  status change made from any other view appends the card to the bottom of
  its new column, and the no-op guard at `:309` compares a column index to a
  stored position — correct only while lists stay dense and aligned.
- **Gantt**: within-section row reorder is **not implemented**.
  `GanttFrame.tsx:409-465` accepts drops only on section headers
  (task → re-section, section → reorder sections). There are no between-row
  drop targets, and row order inherits the same interleaved backend sort via
  `buildRows` in `frontend/src/lib/gantt/geometry.ts`.
- **Subtasks already have the target semantics**: their sibling list is
  keyed on `parentTaskId` alone, and a status change keeps the row's slot
  (`backend/src/routes/tasks.ts:161-167`). The fix is to make top-level
  tasks behave the way subtasks already do.

## Decisions (2026-07-22, user-confirmed)

1. **One shared canonical order** across List, Kanban, and Gantt — the Asana
   model. Reordering in any view is reflected in all views.
2. **Status never reorders.** A task keeps its slot when its status changes;
   in Kanban the card appears in its new column at its relative global slot
   (no more append-to-bottom on status change).
3. **Gantt list pane becomes a full drag peer of the List view**: reorder
   between rows, re-section, and subtask reorder with identical semantics.
   Row drags never touch dates; section reordering stays as-is.

## Evaluated and rejected

- **Per-view orders** (separate list/kanban/gantt position fields): maximum
  freedom, but 2–3 sources of truth that silently disagree, plus migration
  burden. Rejected in refinement.
- **Section-scoped position** (`(sectionId, parentTaskId)`): fixes List and
  Gantt but breaks Kanban — the inverse of today's mismatch, and Kanban is
  the view that currently works.
- **Fractional / LexoRank positions** (avoid dense repack writes): the repo
  already has working dense-repack machinery (`taskOrdering.ts`), and at
  solo-TAM project sizes the N-row repack transaction is nowhere near the
  200ms NFR. Not worth the rewrite; revisit only if profiling says so.
- **Auto-sink Done tasks**: rejected — the manual order is sacred. A
  *transient* sort toggle (by due date, by status) that never overwrites the
  stored order is a possible future view feature, explicitly out of scope.

## Recommended direction

Re-scope top-level `position` to **one dense list per project**, then make
every view's drop math speak that language:

1. **Backend** — `siblingWhere` / `siblingKeyEquals` drop `status` for
   `parentTaskId = null`; a status-only patch stops touching ordering
   (mirroring the existing subtask behavior). `GET /tasks` orderBy is
   already `(position, id)` — unchanged.
2. **Data migration** — one-time repack per project ordered by
   `(section.position, current position, id)`. This preserves today's List
   appearance; Kanban columns re-derive as subsequences of the global order
   (a one-time visible reshuffle there, accepted).
3. **List** — drop handler computes the index in the full top-level global
   list (arrayMove semantics, as Kanban's `computeCardDrop` already does)
   instead of among same-status siblings.
4. **Kanban** — within-column drop maps to "insert relative to the over-card
   in the global list"; a drop on an empty column area becomes a status-only
   patch (keep slot). The mobile move-to-column sheet becomes status-only.
5. **Gantt** — add between-row drop targets + insertion indicator to the
   list pane (`GanttListRow.tsx` / `GanttFrame.tsx`), reusing the List
   handler semantics; subtask rows draggable within their parent.
6. **Optimistic layer** — `siblingListId` in `frontend/src/lib/queries.ts`
   drops `status` for top-level tasks so optimistic reorders match the
   server's post-patch state.

No schema change — `position` stays an `Int`; only its scoping convention
and a data migration change.

## Key assumptions to validate

- [ ] Dense repack per reorder stays under the 200ms NFR at realistic sizes
      — verify with a ~200-task seeded project; add/check an index covering
      `(projectId, parentTaskId, position)` if needed.
- [ ] The `e2e/tests/kanban-dnd` spec passes under global-scope positions —
      update assertions where the append-on-status-change behavior changed
      *intentionally*.
- [ ] The one-time Kanban column reshuffle from the section-major migration
      ordering is acceptable.
- [ ] Exports (`projectExport.ts`, `exportExcel.ts`, `exportPdf.ts`) inherit
      row order from the same geometry/sort path and need no separate fix.

## MVP scope

**In:** backend re-scope + data migration + vitest coverage for the new
sibling semantics; List drop-math fix; Kanban global-index drop-math +
keep-slot status changes; Gantt between-row reorder (full List parity);
optimistic-layer sync; e2e updates.

**Out:** everything under "Evaluated and rejected"; any date-changing
behavior on row drags; sort toggles; cross-project ordering.

Suggested plan-task split: (1) backend scope change + migration + tests,
(2) List, (3) Kanban, (4) Gantt rows, (5) e2e + docs sync.

## Open questions

- Drop into a *collapsed* Gantt section: append at end of that section, or
  reject the drop? (Suggest: append, then flash/expand the section.)
- Does the Gantt "(No section)" pseudo-group accept between-row reorder for
  parity with the List view? (Presumably yes.)
- Kanban drop on the column's bottom padding vs. its empty area: explicit
  "end of column" insert vs. keep-slot status patch — pick one and make it
  consistent with the drag preview.
