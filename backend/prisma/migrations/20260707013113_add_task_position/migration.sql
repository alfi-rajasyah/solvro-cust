-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "tasks_project_id_status_position_idx" ON "tasks"("project_id", "status", "position");

-- Backfill: assign dense 0..n-1 positions to existing rows so the new
-- ordering is stable and matches insertion order (by id) the first time
-- ordered reads/reorders run against pre-existing data.
--
-- Top-level tasks (parent_task_id IS NULL) are partitioned by
-- (project_id, status) — that's the sibling list for a column in a board.
-- Subtasks are partitioned by (parent_task_id) only — status does not
-- partition a subtask list, per the sibling-list semantics used by the
-- reorder/re-parent API.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id, status
      ORDER BY id
    ) - 1 AS new_position
  FROM tasks
  WHERE parent_task_id IS NULL
)
UPDATE tasks
SET position = ranked.new_position
FROM ranked
WHERE tasks.id = ranked.id;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY parent_task_id
      ORDER BY id
    ) - 1 AS new_position
  FROM tasks
  WHERE parent_task_id IS NOT NULL
)
UPDATE tasks
SET position = ranked.new_position
FROM ranked
WHERE tasks.id = ranked.id;
