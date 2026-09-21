-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('EXTERNAL', 'INTERNAL', 'TECHNICAL', 'ORGANIZATIONAL', 'FINANCIAL');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATED', 'CLOSED');

-- CreateTable
CREATE TABLE "risks" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "category" "RiskCategory" NOT NULL DEFAULT 'INTERNAL',
    "probability" INTEGER NOT NULL DEFAULT 1,
    "impact" INTEGER NOT NULL DEFAULT 1,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "mitigation_plan" TEXT,
    "contingency_plan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risks_project_id_idx" ON "risks"("project_id");

-- CreateIndex
CREATE INDEX "risks_status_idx" ON "risks"("status");

-- CreateIndex
CREATE INDEX "risks_category_idx" ON "risks"("category");

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
