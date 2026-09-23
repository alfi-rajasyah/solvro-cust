-- AlterTable
ALTER TABLE "itop_tickets" ADD COLUMN     "private_log" JSONB,
ADD COLUMN     "public_log" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "itop_token_checked_at" TIMESTAMP(3),
ADD COLUMN     "itop_token_enc" TEXT,
ADD COLUMN     "itop_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "itop_token_person_name" TEXT;
