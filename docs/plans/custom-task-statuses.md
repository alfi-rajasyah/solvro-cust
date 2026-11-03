# Implementation Plan: Custom task statuses (workspace-wide, grouped by category)

**Branches:** two phases, each its own branch and PR into `develop`, cut from `origin/develop`:
`feat/task-status-defs` (Phase A), then `feat/task-status-ui` (Phase B).
Tasks = commits. No commit or PR without explicit user approval.
**Source:** user request triage, 2026-11-03, request #3 ("change how status dropdown shows… Backlog,
Development, Progress… customizable"). User decisions:
- custom statuses, each in one of 3 fixed categories;
- **one list for the whole workspace**.

**Approved design:** Doop canvas `wIbMMkOajZ`, page "07 · Request triage — Nov 2026", frames "Triage 03"
(`nKuH5x6OFc`, admin editor) and "Triage 04" (`14i6WySKUN`, Kanban + grouped dropdown).
**Size:** L. Schema, migration, `routes/tasks.ts`, `routes/projects.ts`, `kanban-v2/adapter.ts` +
`commitMapper.ts`, `gantt-v2/`, `lib/queries.ts`: all spine. Every task here gets an instant review.

---

## 1. Model

```prisma
model TaskStatusDef {
  id        Int        @id @default(autoincrement())
  name      String     @unique            // "Backlog", "QA / UAT"
  category  TaskStatus                    // TODO | IN_PROGRESS | DONE — the existing enum
  color     String                        // hex, validated against a fixed palette
  position  Int                           // order across the whole list
  isDefault Boolean    @default(false)    // exactly one per category
  tasks     Task[]
  @@map("task_status_defs")
}
// Task gains: statusId Int @map("status_id") → TaskStatusDef (onDelete: Restrict)
```

**The enum stays, as the category.** `Task.status` remains, and every write keeps it equal to
`statusDef.category`. That one rule is why most of the code needs no change: overdue, progress, health,
portfolio, Daily Review, Executive, share links, Gantt bar colours and exports all ask "is it done / is it
open?" and keep reading `status` unchanged. The inventory found ~60 such reads.

**Rules:**
- Each category must keep ≥1 def, and exactly one `isDefault` per category.
- New tasks get the default def of TODO.
- A write that sends only a category (old clients, done toggles: TODO↔DONE) maps to that category's default def.
- Deleting a def that has tasks needs a `moveTo` def, applied in the same transaction.
- **Epics stay on the three categories** (as the approved editor states). `Epic.status` is untouched, and `TaskStatusChip` must keep accepting a bare category.

## 2. Phase A: data and API, no visible change

### A1: Schema and migration
- Add `TaskStatusDef` and `Task.statusId`.
- Migration seeds three defs named **exactly today's labels**: "To do" (TODO, default), "In progress" (IN_PROGRESS, default), "Done" (DONE, default). It backfills `statusId` from `status`, then sets `NOT NULL`.
- Rewrite `Project.wipLimits` JSON keys from TODO/IN_PROGRESS/DONE to the new def ids as strings.
- After A1, every screen looks identical. That's the safety net for the phase.

### A2: Task writes and reads
- **`routes/tasks.ts`:**
  - Update body accepts `statusId` (or legacy `status`). The server derives `status` and writes both.
  - The stale-write `expectedTaskSchema` compares `statusId`.
  - The `?status=` filter keeps category semantics, and a new `?statusId=` is added.
- **`routes/projects.ts`:** create-task default, and the project task-list filter, same rules. `wipLimitsSchema` becomes a record keyed by def id (a known def, `int|null`).
- **`lib/duplicate.ts`:** a duplicate resets to the TODO default def, not the literal `"TODO"`.
- **`lib/activity.ts`:** diff `statusId` and log `{from, to}` def names, so a move between two custom statuses in the same category is recorded.
- **Payloads:** task responses include `statusDef: {id, name, color, category}`, and so do daily-review overdue rows and search hits (for display).
- **Defs API:**
  - `GET /task-statuses` (any authed user with `project:read`).
  - `PUT /admin/task-statuses` (`requireAdmin`): a whole-list save, validated with the rules above. The `moveTo` reassignments run in one transaction.
- **Seeds:** `scripts/seed-demo.ts` and `e2e/fixtures/seed.ts` create the defs and set `statusId`.

**Acceptance:**
- All existing backend tests pass, with fixtures updated only where they build tasks.
- New tests:
  - a legacy `status` write maps to the default def;
  - category and def stay in sync;
  - deleting a def without `moveTo` gives 409;
  - the last def in a category can't be deleted;
  - WIP keys migrate;
  - the activity log records a same-category move.
- Tests that need rework, per the inventory: `taskStaleWrite`, `projectWipLimits`, `activity`.

## 3. Phase B: the UI

### B1: Admin → Task statuses tab ("Triage 03")
- List grouped by category, with drag reorder (vendored `reui/sortable`), name, colour swatch, a default marker, task counts, and add / rename / delete.
- Delete-with-tasks opens a "Move N tasks to…" picker. Save writes the whole list.

### B2: One status picker everywhere ("Triage 04" dropdown)
- New `StatusSelect`: options grouped under the three category headers, with def colour dots.
- It replaces every hardcoded `STATUSES` array:
  - `TaskPanel.tsx`
  - `TaskFormModal.tsx`
  - `ProjectList.tsx`
  - `ProjectTimeline.tsx`
  - `daily-review/ProjectCard.tsx`
  - the Tasks page filter (grouped, and a whole category can be selected).
- `TaskStatusChip` shows the def name and colour. A bare category (epics, guests) falls back to today's tone. **The chip stays bespoke** (standing decision: never rebase it onto `reui/badge`).

### B3: Kanban columns per status
- `kanban-v2/adapter.ts`, `commitMapper.ts`, `SolvroKanban.tsx` and `MobileMoveSheet.tsx`: columns come from the defs in `position` order, and a drop writes `statusId`.
- Add a category band above the columns.
- The WIP pill reads `wipLimits[defId]`.
- DONE-category columns can collapse (per viewer, `localStorage`).
- `ProjectFormModal`'s WIP form lists one row per def.
- Rework the Kanban tests: `commitMapper.test.ts`, `adapter.test.ts`, `e2e/kanban-dnd.spec.ts`.

### B4: Other displays
- Gantt tree status cell (`gantt-v2/TreeCells.tsx`): def name and dot.
- Embed task list: def name.
- Tasks page: sort by def `position`.
- Gantt bar colours and both exports stay category-based.
- **Guardrail check on the exports:** they gain no new fields, and only the status *name* may change in any text column. Notes are untouched.

## 4. Out of scope
- Per-project status lists: the user chose workspace-wide.
- Workflow rules ("QA only from Development").
- Status-based automation.

## 5. Verification
- Each phase runs the full `gates.sh` at integration, plus the instant spine reviews.
- Phase A's bar: the UI is pixel-identical, and the e2e suite is green without UI changes.
- Phase B manual pass: rename "To do" → "Backlog" and add "QA / UAT", then check Kanban, List, panel, Tasks page, Gantt, embed, and a guest share link (which must still show only phase status).

## 6. CHANGELOG (drafts)
- **Phase A:** Changed: task statuses are now stored as workspace-defined statuses, each belonging to To do / In progress / Done. The existing three statuses are migrated as-is, so nothing looks different yet. New `GET /task-statuses` and `PUT /admin/task-statuses`.
- **Phase B:** Added: admins can rename, add, reorder and remove task statuses (Admin → Task statuses). The Kanban board shows one column per status, and every status picker groups statuses by category.
