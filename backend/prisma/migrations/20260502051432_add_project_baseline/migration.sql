-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "baseline_locked_at" TIMESTAMP(3),
ADD COLUMN     "baseline_locked_by_id" INTEGER;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "baseline_due_date" TIMESTAMP(3),
ADD COLUMN     "baseline_start_date" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_baseline_locked_by_id_fkey" FOREIGN KEY ("baseline_locked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
