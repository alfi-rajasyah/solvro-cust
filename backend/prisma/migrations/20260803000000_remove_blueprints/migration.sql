-- DropForeignKey
ALTER TABLE "blueprints" DROP CONSTRAINT "blueprints_project_id_fkey";

-- DropTable
DROP TABLE "blueprints";
