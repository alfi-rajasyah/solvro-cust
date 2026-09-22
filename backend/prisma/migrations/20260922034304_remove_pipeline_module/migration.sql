-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_pic_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_project_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_activities" DROP CONSTRAINT "opportunity_activities_opportunity_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_activities" DROP CONSTRAINT "opportunity_activities_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opportunity_links" DROP CONSTRAINT "opportunity_links_opportunity_id_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_import_logs" DROP CONSTRAINT "pipeline_import_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_sa_id_fkey";

-- DropIndex
DROP INDEX "projects_sa_id_idx";

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "sa_id";

-- DropTable
DROP TABLE "opportunities";

-- DropTable
DROP TABLE "opportunity_activities";

-- DropTable
DROP TABLE "opportunity_links";

-- DropTable
DROP TABLE "pipeline_import_logs";

-- DropEnum
DROP TYPE "PipelineImportStatus";

-- DropEnum
DROP TYPE "PipelineStage";

