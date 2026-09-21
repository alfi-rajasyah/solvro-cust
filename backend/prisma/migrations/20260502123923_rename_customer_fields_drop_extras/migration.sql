-- Rename customer fields to match domain language and drop unused fields.
-- Preserves data via RENAME COLUMN (rather than DROP + ADD which would null out values).

ALTER TABLE "customers" DROP COLUMN "industry";
ALTER TABLE "customers" DROP COLUMN "website";

ALTER TABLE "customers" RENAME COLUMN "contact_name" TO "account_manager";
ALTER TABLE "customers" RENAME COLUMN "contact_email" TO "solution_architect";
ALTER TABLE "customers" RENAME COLUMN "notes" TO "description";

-- Backfill so the NOT NULL constraint can be added without orphaning rows.
UPDATE "customers" SET "description" = '' WHERE "description" IS NULL;
ALTER TABLE "customers" ALTER COLUMN "description" SET NOT NULL;
