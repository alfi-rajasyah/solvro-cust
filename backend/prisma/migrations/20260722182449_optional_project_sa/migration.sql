-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_sa_id_fkey";

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "sa_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_sa_id_fkey" FOREIGN KEY ("sa_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
