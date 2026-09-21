-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "is_milestone" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve current visuals. Tasks the frontend previously derived
-- as milestones (same-day range, or due-date-only) become explicit ones.
UPDATE "tasks" SET "is_milestone" = true
WHERE ("start_date" IS NOT NULL AND "due_date" IS NOT NULL
       AND "start_date"::date = "due_date"::date)
   OR ("start_date" IS NULL AND "due_date" IS NOT NULL);
