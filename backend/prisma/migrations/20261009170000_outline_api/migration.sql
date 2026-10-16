-- AlterTable
-- updated_at becomes the admin audit stamp (set explicitly by the admin routes,
-- no longer @updatedAt), so system writes such as last_webhook_at never move it.
ALTER TABLE "outline_config" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "outline_config" ADD COLUMN     "last_webhook_at" TIMESTAMP(3),
ADD COLUMN     "oauth_client_id" TEXT,
ADD COLUMN     "oauth_client_secret_enc" TEXT,
ADD COLUMN     "webhook_secret_enc" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "outline_access_token_enc" TEXT,
ADD COLUMN     "outline_email" TEXT,
ADD COLUMN     "outline_refresh_token_enc" TEXT,
ADD COLUMN     "outline_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "outline_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_outline_user_id_key" ON "users"("outline_user_id");

-- CreateTable
CREATE TABLE "outline_oauth_states" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code_verifier_enc" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outline_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outline_mentions" (
    "id" SERIAL NOT NULL,
    "outline_doc_id" TEXT NOT NULL,
    "doc_title" TEXT NOT NULL,
    "doc_path" TEXT NOT NULL,
    "project_id" INTEGER,
    "task_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outline_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outline_oauth_states_expires_at_idx" ON "outline_oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "outline_oauth_states_user_id_idx" ON "outline_oauth_states"("user_id");

-- CreateIndex
CREATE INDEX "outline_mentions_project_id_idx" ON "outline_mentions"("project_id");

-- CreateIndex
CREATE INDEX "outline_mentions_task_id_idx" ON "outline_mentions"("task_id");

-- CreateIndex
-- NULLS NOT DISTINCT (PostgreSQL 15+): a plain unique index treats NULLs as
-- distinct, so two project-level mentions (task_id NULL) of the same page would
-- both be accepted. Prisma cannot express it; the schema keeps a plain @@unique
-- with the same name, which introspects identically (no drift).
CREATE UNIQUE INDEX "outline_mentions_outline_doc_id_project_id_task_id_key" ON "outline_mentions"("outline_doc_id", "project_id", "task_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "outline_oauth_states" ADD CONSTRAINT "outline_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outline_mentions" ADD CONSTRAINT "outline_mentions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outline_mentions" ADD CONSTRAINT "outline_mentions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A mention is EITHER project-level OR task-level: exactly one of the two ids.
ALTER TABLE "outline_mentions" ADD CONSTRAINT "outline_mentions_anchor_check" CHECK (num_nonnulls("project_id", "task_id") = 1);
