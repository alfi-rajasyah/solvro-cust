-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "itop_org_id" INTEGER,
ADD COLUMN     "itop_org_name" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "itop_person_id" INTEGER,
ADD COLUMN     "itop_user_id" INTEGER;

-- CreateTable
CREATE TABLE "itop_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "base_url" TEXT,
    "app_token_enc" TEXT,
    "webhook_secret_enc" TEXT,
    "refresh_minutes" INTEGER NOT NULL DEFAULT 5,
    "read_classes" TEXT[] DEFAULT ARRAY['UserRequest', 'Incident']::TEXT[],
    "capacity_hours_per_week" INTEGER NOT NULL DEFAULT 40,
    "actions_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_ok" BOOLEAN,
    "last_sync_error" TEXT,
    "last_full_sync_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" INTEGER,

    CONSTRAINT "itop_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itop_tickets" (
    "id" INTEGER NOT NULL,
    "class" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operational_status" TEXT,
    "priority" TEXT,
    "agent_person_id" INTEGER,
    "agent_name" TEXT,
    "team_name" TEXT,
    "service_name" TEXT,
    "caller_name" TEXT,
    "org_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "start_date" TIMESTAMP(3),
    "last_update" TIMESTAMP(3) NOT NULL,
    "tto" TIMESTAMP(3),
    "ttr" TIMESTAMP(3),
    "sla_tto_passed" BOOLEAN NOT NULL DEFAULT false,
    "sla_ttr_passed" BOOLEAN NOT NULL DEFAULT false,
    "resolution_date" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itop_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "itop_tickets_ref_key" ON "itop_tickets"("ref");

-- CreateIndex
CREATE INDEX "itop_tickets_customer_id_idx" ON "itop_tickets"("customer_id");

-- CreateIndex
CREATE INDEX "itop_tickets_status_idx" ON "itop_tickets"("status");

-- CreateIndex
CREATE INDEX "itop_tickets_last_update_idx" ON "itop_tickets"("last_update");

-- CreateIndex
CREATE INDEX "itop_tickets_agent_person_id_idx" ON "itop_tickets"("agent_person_id");

-- CreateIndex
CREATE INDEX "itop_tickets_org_id_idx" ON "itop_tickets"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_itop_org_id_key" ON "customers"("itop_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_itop_person_id_key" ON "users"("itop_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_itop_user_id_key" ON "users"("itop_user_id");

-- AddForeignKey
ALTER TABLE "itop_config" ADD CONSTRAINT "itop_config_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itop_tickets" ADD CONSTRAINT "itop_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

