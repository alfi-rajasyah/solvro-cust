-- DropIndex
DROP INDEX "itop_tickets_customer_id_idx";

-- CreateIndex
CREATE INDEX "itop_time_entries_ticket_id_idx" ON "itop_time_entries"("ticket_id");

-- CreateIndex
CREATE INDEX "itop_time_entries_start_date_idx" ON "itop_time_entries"("start_date");

