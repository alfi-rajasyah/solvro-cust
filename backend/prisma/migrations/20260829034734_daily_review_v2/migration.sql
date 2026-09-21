-- CreateEnum
CREATE TYPE "WeeklyHealth" AS ENUM ('GREEN', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "WeeklyStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'DONE');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "tam_id" INTEGER;

-- AlterTable (note_date / updated_at added nullable, backfilled, then locked NOT NULL
-- so existing project_notes rows survive the migration)
ALTER TABLE "project_notes" ADD COLUMN     "note_date" DATE,
ADD COLUMN     "updated_at" TIMESTAMP(3);

UPDATE "project_notes" SET "note_date" = "created_at"::date;
UPDATE "project_notes" SET "updated_at" = "created_at";

ALTER TABLE "project_notes" ALTER COLUMN "note_date" SET NOT NULL;
ALTER TABLE "project_notes" ALTER COLUMN "updated_at" SET NOT NULL;

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "note_date" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_updates" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "week_start" DATE NOT NULL,
    "author_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "health" "WeeklyHealth",
    "status" "WeeklyStatus" NOT NULL DEFAULT 'DRAFT',
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_reviews" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "review_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_note_date_idx" ON "customer_notes"("customer_id", "note_date");

-- CreateIndex
CREATE INDEX "customer_notes_author_id_idx" ON "customer_notes"("author_id");

-- CreateIndex
CREATE INDEX "weekly_updates_author_id_idx" ON "weekly_updates"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_updates_customer_id_week_start_key" ON "weekly_updates"("customer_id", "week_start");

-- CreateIndex
CREATE INDEX "project_reviews_user_id_review_date_idx" ON "project_reviews"("user_id", "review_date");

-- CreateIndex
CREATE UNIQUE INDEX "project_reviews_project_id_user_id_review_date_key" ON "project_reviews"("project_id", "user_id", "review_date");

-- CreateIndex
CREATE INDEX "customers_tam_id_idx" ON "customers"("tam_id");

-- CreateIndex
CREATE INDEX "project_notes_project_id_note_date_idx" ON "project_notes"("project_id", "note_date");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tam_id_fkey" FOREIGN KEY ("tam_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reviews" ADD CONSTRAINT "project_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reviews" ADD CONSTRAINT "project_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
