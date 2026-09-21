-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('INTERNAL', 'CUSTOMER_FACING');

-- CreateTable
CREATE TABLE "project_notes" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'INTERNAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_notes_project_id_created_at_idx" ON "project_notes"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_notes_author_id_idx" ON "project_notes"("author_id");

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
