-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "mentioned_user_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

