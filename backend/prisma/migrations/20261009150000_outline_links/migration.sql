-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "outline_url" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "outline_url" TEXT;

-- CreateTable
CREATE TABLE "outline_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "base_url" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" INTEGER,

    CONSTRAINT "outline_config_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "outline_config" ADD CONSTRAINT "outline_config_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the singleton row (base URL unset until an admin saves one).
INSERT INTO "outline_config" ("id", "updated_at") VALUES ('default', CURRENT_TIMESTAMP);
