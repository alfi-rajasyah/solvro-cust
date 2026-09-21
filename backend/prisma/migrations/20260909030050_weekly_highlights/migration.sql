-- CreateTable
CREATE TABLE "weekly_highlights" (
    "id" SERIAL NOT NULL,
    "weekly_update_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" TEXT,
    "risk" TEXT,
    "action" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_highlights_weekly_update_id_position_key" ON "weekly_highlights"("weekly_update_id", "position");

-- AddForeignKey
ALTER TABLE "weekly_highlights" ADD CONSTRAINT "weekly_highlights_weekly_update_id_fkey" FOREIGN KEY ("weekly_update_id") REFERENCES "weekly_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data move (D7): one row at position 0 per week that has any Mid-week text.
-- Title = first line of the old highlight, cut at 200 ("Untitled" when there is
-- none). Detail = the text after the first line break; the full text when the
-- first line was longer than 200. Risk and action move onto the same row.
INSERT INTO "weekly_highlights" ("weekly_update_id", "position", "title", "detail", "risk", "action", "created_at", "updated_at")
SELECT
  h."id",
  0,
  COALESCE(NULLIF(LEFT(h."first_line", 200), ''), 'Untitled'),
  CASE
    WHEN h."text" IS NULL THEN NULL
    WHEN LENGTH(h."first_line") > 200 THEN h."text"
    WHEN POSITION(E'\n' IN h."text") = 0 THEN NULL
    ELSE NULLIF(BTRIM(SUBSTRING(h."text" FROM POSITION(E'\n' IN h."text") + 1), E' \t\r\n'), '')
  END,
  h."risk",
  h."action",
  h."updated_at",
  h."updated_at"
FROM (
  SELECT
    wu."id", wu."risk", wu."action", wu."updated_at",
    NULLIF(BTRIM(replace(replace(wu."highlight", E'\r\n', E'\n'), E'\r', E'\n'), E' \t\r\n'), '') AS "text",
    BTRIM(split_part(COALESCE(NULLIF(BTRIM(replace(replace(wu."highlight", E'\r\n', E'\n'), E'\r', E'\n'), E' \t\r\n'), ''), ''), E'\n', 1), E' \t\r') AS "first_line"
  FROM "weekly_updates" wu
) h
WHERE h."text" IS NOT NULL OR h."risk" IS NOT NULL OR h."action" IS NOT NULL;

-- AlterTable
ALTER TABLE "weekly_updates" DROP COLUMN "highlight",
DROP COLUMN "risk",
DROP COLUMN "action";
