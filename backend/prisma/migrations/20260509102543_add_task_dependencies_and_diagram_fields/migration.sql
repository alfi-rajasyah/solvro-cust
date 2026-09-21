-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('HARD', 'SOFT');

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#94a3b8';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "diagram_x" DOUBLE PRECISION,
ADD COLUMN     "diagram_y" DOUBLE PRECISION,
ADD COLUMN     "is_milestone" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "predecessor_task_id" INTEGER NOT NULL,
    "successor_task_id" INTEGER NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'HARD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_dependencies_project_id_idx" ON "task_dependencies"("project_id");

-- CreateIndex
CREATE INDEX "task_dependencies_successor_task_id_idx" ON "task_dependencies"("successor_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_predecessor_task_id_successor_task_id_key" ON "task_dependencies"("predecessor_task_id", "successor_task_id");

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_predecessor_task_id_fkey" FOREIGN KEY ("predecessor_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_successor_task_id_fkey" FOREIGN KEY ("successor_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
