-- DropIndex
DROP INDEX "tasks_project_id_status_position_idx";

-- CreateIndex
CREATE INDEX "tasks_project_id_position_idx" ON "tasks"("project_id", "position");

-- Repack top-level positions into ONE dense per-project list (status no
-- longer partitions ordering — see docs/ideas/unified-manual-task-ordering.md).
-- Order: section position (No-section last), then old (position, id).
WITH ordered AS (
  SELECT t.id AS task_id,
         ROW_NUMBER() OVER (
           PARTITION BY t.project_id
           ORDER BY COALESCE(s.position, 2147483647),
                    COALESCE(s.id, 2147483647),
                    t.position,
                    t.id
         ) - 1 AS new_pos
  FROM tasks t
  LEFT JOIN sections s ON s.id = t.section_id
  WHERE t.parent_task_id IS NULL
)
UPDATE tasks SET position = ordered.new_pos
FROM ordered
WHERE tasks.id = ordered.task_id;
