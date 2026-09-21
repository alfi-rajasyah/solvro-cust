-- CreateTable
CREATE TABLE "weekly_achievements" (
    "id" SERIAL NOT NULL,
    "weekly_update_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" TEXT,
    "outstanding_issue" TEXT,
    "lesson_learned" TEXT,
    "next_week_focus" TEXT,
    "manager_decision" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_achievements_weekly_update_id_position_key" ON "weekly_achievements"("weekly_update_id", "position");

-- AddForeignKey
ALTER TABLE "weekly_achievements" ADD CONSTRAINT "weekly_achievements_weekly_update_id_fkey" FOREIGN KEY ("weekly_update_id") REFERENCES "weekly_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data move: one row at position 0 per week that has any Reflection text.
-- Title = first line of the old achievement, cut at 200 ("Untitled" when
-- there is none). Detail = the text after the first line break; the full
-- text when the first line was longer than 200. The four Reflection texts
-- move onto the same row.
INSERT INTO "weekly_achievements" ("weekly_update_id", "position", "title", "detail", "outstanding_issue", "lesson_learned", "next_week_focus", "manager_decision", "created_at", "updated_at")
SELECT
  h."id", 0,
  COALESCE(NULLIF(LEFT(h."first_line", 200), ''), 'Untitled'),
  CASE
    WHEN h."text" IS NULL THEN NULL
    WHEN LENGTH(h."first_line") > 200 THEN h."text"
    WHEN POSITION(E'\n' IN h."text") = 0 THEN NULL
    ELSE NULLIF(BTRIM(SUBSTRING(h."text" FROM POSITION(E'\n' IN h."text") + 1), E' \t\r\n'), '')
  END,
  h."outstanding_issue", h."lesson_learned", h."next_week_focus", h."manager_decision",
  h."updated_at", h."updated_at"
FROM (
  SELECT
    wu."id", wu."outstanding_issue", wu."lesson_learned", wu."next_week_focus", wu."manager_decision", wu."updated_at",
    NULLIF(BTRIM(replace(replace(wu."achievement", E'\r\n', E'\n'), E'\r', E'\n'), E' \t\r\n'), '') AS "text",
    BTRIM(split_part(COALESCE(NULLIF(BTRIM(replace(replace(wu."achievement", E'\r\n', E'\n'), E'\r', E'\n'), E' \t\r\n'), ''), ''), E'\n', 1), E' \t\r') AS "first_line"
  FROM "weekly_updates" wu
) h
WHERE h."text" IS NOT NULL OR h."outstanding_issue" IS NOT NULL OR h."lesson_learned" IS NOT NULL OR h."next_week_focus" IS NOT NULL OR h."manager_decision" IS NOT NULL;

-- AlterTable
ALTER TABLE "weekly_updates" DROP COLUMN "achievement",
DROP COLUMN "outstanding_issue",
DROP COLUMN "lesson_learned",
DROP COLUMN "next_week_focus",
DROP COLUMN "manager_decision";
