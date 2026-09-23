-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "itop_ticket_ref" TEXT;

-- CreateIndex
CREATE INDEX "tasks_itop_ticket_ref_idx" ON "tasks"("itop_ticket_ref");
