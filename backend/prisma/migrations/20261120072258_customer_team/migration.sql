-- AlterTable
ALTER TABLE "customer_activity_events" ADD COLUMN     "member_id" INTEGER,
ADD COLUMN     "member_name" TEXT,
ALTER COLUMN "project_id" DROP NOT NULL,
ALTER COLUMN "project_name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "customer_team_members" (
    "customer_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "added_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_team_members_pkey" PRIMARY KEY ("customer_id","user_id")
);

-- CreateIndex
CREATE INDEX "customer_team_members_user_id_idx" ON "customer_team_members"("user_id");

-- AddForeignKey
ALTER TABLE "customer_team_members" ADD CONSTRAINT "customer_team_members_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_team_members" ADD CONSTRAINT "customer_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_team_members" ADD CONSTRAINT "customer_team_members_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
