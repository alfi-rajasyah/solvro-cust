-- CreateTable
CREATE TABLE "project_services" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_services_project_id_idx" ON "project_services"("project_id");

-- CreateIndex
CREATE INDEX "project_services_service_id_idx" ON "project_services"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_services_project_id_service_id_key" ON "project_services"("project_id", "service_id");

-- AddForeignKey
ALTER TABLE "project_services" ADD CONSTRAINT "project_services_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_services" ADD CONSTRAINT "project_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Start-fresh reset (approved): retire admin-curated catalogue data
DELETE FROM "customer_services";
DELETE FROM "services";
