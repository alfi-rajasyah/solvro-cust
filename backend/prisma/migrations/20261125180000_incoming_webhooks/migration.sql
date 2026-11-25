-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "inbound_hook_id" INTEGER,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "inbound_hooks" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_preview" TEXT NOT NULL,
    "signing_secret_enc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "disabled_reason" TEXT,
    "last_received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_hook_links" (
    "id" SERIAL NOT NULL,
    "hook_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL,
    "source_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_hook_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_hook_messages" (
    "id" SERIAL NOT NULL,
    "hook_id" INTEGER NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_hook_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_hooks_token_hash_key" ON "inbound_hooks"("token_hash");

-- CreateIndex
CREATE INDEX "inbound_hooks_project_id_idx" ON "inbound_hooks"("project_id");

-- CreateIndex
CREATE INDEX "inbound_hook_links_hook_id_idx" ON "inbound_hook_links"("hook_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_hook_links_task_id_source_key_key" ON "inbound_hook_links"("task_id", "source_key");

-- CreateIndex
CREATE INDEX "inbound_hook_messages_created_at_idx" ON "inbound_hook_messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_hook_messages_hook_id_message_id_key" ON "inbound_hook_messages"("hook_id", "message_id");

-- CreateIndex
CREATE INDEX "comments_inbound_hook_id_idx" ON "comments"("inbound_hook_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_inbound_hook_id_fkey" FOREIGN KEY ("inbound_hook_id") REFERENCES "inbound_hooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_hooks" ADD CONSTRAINT "inbound_hooks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_hooks" ADD CONSTRAINT "inbound_hooks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_hook_links" ADD CONSTRAINT "inbound_hook_links_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "inbound_hooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_hook_links" ADD CONSTRAINT "inbound_hook_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_hook_messages" ADD CONSTRAINT "inbound_hook_messages_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "inbound_hooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

