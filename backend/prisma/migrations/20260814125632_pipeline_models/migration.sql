-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('assessment', 'rfp', 'deliver_proposal', 'waiting_response', 'won', 'drop');

-- CreateEnum
CREATE TYPE "PipelineImportStatus" AS ENUM ('ok', 'error');

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "deal_value" BIGINT NOT NULL DEFAULT 0,
    "stage" "PipelineStage" NOT NULL DEFAULT 'assessment',
    "pic_id" INTEGER,
    "deadline" DATE,
    "description" TEXT,
    "product_solution" TEXT NOT NULL DEFAULT '',
    "lead_source" TEXT,
    "win_probability" INTEGER NOT NULL DEFAULT 50,
    "stage_order" INTEGER NOT NULL DEFAULT 0,
    "won_at" TIMESTAMP(3),
    "project_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_activities" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_links" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_import_logs" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_count" INTEGER NOT NULL DEFAULT 0,
    "skip_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "status" "PipelineImportStatus" NOT NULL DEFAULT 'ok',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_project_id_key" ON "opportunities"("project_id");

-- CreateIndex
CREATE INDEX "opportunities_stage_idx" ON "opportunities"("stage");

-- CreateIndex
CREATE INDEX "opportunities_pic_id_idx" ON "opportunities"("pic_id");

-- CreateIndex
CREATE INDEX "opportunity_activities_opportunity_id_idx" ON "opportunity_activities"("opportunity_id");

-- CreateIndex
CREATE INDEX "opportunity_links_opportunity_id_idx" ON "opportunity_links"("opportunity_id");

-- CreateIndex
CREATE INDEX "pipeline_import_logs_created_at_idx" ON "pipeline_import_logs"("created_at");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pic_id_fkey" FOREIGN KEY ("pic_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_links" ADD CONSTRAINT "opportunity_links_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_import_logs" ADD CONSTRAINT "pipeline_import_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
