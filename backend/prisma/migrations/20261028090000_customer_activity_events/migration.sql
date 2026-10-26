-- CreateTable
CREATE TABLE "customer_activity_events" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER,
    "actor_id" INTEGER,
    "action" TEXT NOT NULL,
    "project_id" INTEGER NOT NULL,
    "project_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_activity_events_customer_id_created_at_idx" ON "customer_activity_events"("customer_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "customer_activity_events" ADD CONSTRAINT "customer_activity_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_activity_events" ADD CONSTRAINT "customer_activity_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

