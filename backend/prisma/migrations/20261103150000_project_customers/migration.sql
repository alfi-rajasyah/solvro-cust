-- One project, several customers (docs/archive/plans/multi-customer-projects.md).

-- CreateTable
CREATE TABLE "project_customers" (
    "project_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_customers_pkey" PRIMARY KEY ("project_id","customer_id")
);

-- CreateIndex
CREATE INDEX "project_customers_customer_id_idx" ON "project_customers"("customer_id");

-- AddForeignKey
ALTER TABLE "project_customers" ADD CONSTRAINT "project_customers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_customers" ADD CONSTRAINT "project_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every project that had a customer gets one primary link.
INSERT INTO "project_customers" ("project_id", "customer_id", "is_primary")
SELECT "id", "customer_id", true FROM "projects" WHERE "customer_id" IS NOT NULL;

-- At most one primary link per project (Prisma cannot express a partial index).
CREATE UNIQUE INDEX "project_customers_one_primary_idx" ON "project_customers"("project_id") WHERE "is_primary";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_customer_id_fkey";

-- DropIndex
DROP INDEX "projects_customer_id_idx";

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "customer_id";
