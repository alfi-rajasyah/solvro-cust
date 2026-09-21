-- AlterTable
ALTER TABLE "weekly_updates" ADD COLUMN     "category" VARCHAR(120),
ADD COLUMN     "highlight" TEXT,
ADD COLUMN     "risk" TEXT,
ADD COLUMN     "action" TEXT,
ADD COLUMN     "achievement" TEXT,
ADD COLUMN     "outstanding_issue" TEXT,
ADD COLUMN     "lesson_learned" TEXT,
ADD COLUMN     "next_week_focus" TEXT,
ADD COLUMN     "manager_decision" TEXT,
ADD COLUMN     "midweek_saved_at" TIMESTAMP(3);

-- Data move: every existing free-text `body` becomes the Reflection tab's
-- Weekly Achievement field. Whitespace-only values (spaces, tabs, newlines)
-- become NULL (empty text is never stored).
UPDATE "weekly_updates" SET "achievement" = NULLIF(BTRIM("body", E' \t\r\n'), '');

-- AlterTable
ALTER TABLE "weekly_updates" DROP COLUMN "body";
