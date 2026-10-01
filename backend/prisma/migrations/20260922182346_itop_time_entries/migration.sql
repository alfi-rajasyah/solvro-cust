-- DropIndex
DROP INDEX "itop_tickets_status_idx";

-- CreateTable
CREATE TABLE "itop_time_entries" (
    "id" INTEGER NOT NULL,
    "itop_user_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "org_id" INTEGER,
    "customer_id" INTEGER,
    "ticket_id" INTEGER,
    "ticket_ref" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "duration_minutes" INTEGER NOT NULL,
    "title" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itop_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itop_time_entries_user_id_start_date_idx" ON "itop_time_entries"("user_id", "start_date");

-- CreateIndex
CREATE INDEX "itop_time_entries_customer_id_start_date_idx" ON "itop_time_entries"("customer_id", "start_date");

-- CreateIndex
CREATE INDEX "itop_time_entries_itop_user_id_idx" ON "itop_time_entries"("itop_user_id");

-- CreateIndex
CREATE INDEX "itop_tickets_customer_id_status_idx" ON "itop_tickets"("customer_id", "status");

-- AddForeignKey
ALTER TABLE "itop_time_entries" ADD CONSTRAINT "itop_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itop_time_entries" ADD CONSTRAINT "itop_time_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itop_time_entries" ADD CONSTRAINT "itop_time_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "itop_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

