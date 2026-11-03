-- Custom task statuses, phase A (docs/archive/plans/custom-task-statuses.md §2):
-- a workspace-wide list of admin-defined statuses, each in one of the three
-- fixed categories (the TaskStatus enum, which stays on tasks.status).
-- Nothing looks different yet: the three seeded statuses carry today's labels.

-- CreateTable
CREATE TABLE "task_status_defs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TaskStatus" NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "task_status_defs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_status_defs_name_key" ON "task_status_defs"("name");

-- At most one default status per category (hand-written: Prisma cannot
-- express a partial unique index). The admin save route enforces "exactly one".
CREATE UNIQUE INDEX "task_status_defs_one_default_per_category"
  ON "task_status_defs"("category") WHERE "is_default";

-- Seed the three statuses with today's labels and chip tones. `color` is a
-- tone key (gray | primary | emerald | amber | violet), not a hex, so a chip
-- keeps StatusChip's theme-aware bg/text pairs; "primary" is the tint
-- StatusChip calls "blue". To do = gray, In progress = primary, Done = emerald.
INSERT INTO "task_status_defs" ("name", "category", "color", "position", "is_default") VALUES
  ('To do',       'TODO',        'gray', 0, true),
  ('In progress', 'IN_PROGRESS', 'primary', 1, true),
  ('Done',        'DONE',        'emerald', 2, true);

-- AlterTable: add nullable, backfill from the category, then lock it down.
ALTER TABLE "tasks" ADD COLUMN "status_id" INTEGER;

UPDATE "tasks" t
SET "status_id" = d."id"
FROM "task_status_defs" d
WHERE d."category" = t."status" AND d."is_default";

ALTER TABLE "tasks" ALTER COLUMN "status_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_status_id_idx" ON "tasks"("status_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "task_status_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WIP limits were keyed by category ("TODO" / "IN_PROGRESS" / "DONE"); re-key
-- them by the matching default status id (as a string). A null limit stays
-- null; absent keys stay absent; a SQL NULL column is untouched.
UPDATE "projects" p
SET "wip_limits" = COALESCE(
  (
    SELECT jsonb_object_agg(d."id"::text, p."wip_limits" -> d."category"::text)
    FROM "task_status_defs" d
    WHERE d."is_default" AND p."wip_limits" ? d."category"::text
  ),
  '{}'::jsonb
)
WHERE p."wip_limits" IS NOT NULL AND jsonb_typeof(p."wip_limits") = 'object';
