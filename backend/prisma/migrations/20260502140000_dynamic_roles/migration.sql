-- Convert Role.role_name from the RoleName enum to plain TEXT so admins
-- can create custom roles at runtime via POST /admin/roles. Existing
-- four built-in role names (ADMIN, SA, TAM, STAKEHOLDER) are preserved
-- as text values; the enum type is dropped after the column is converted.

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "role_name" TYPE TEXT USING "role_name"::TEXT;

-- DropEnum
DROP TYPE "RoleName";
