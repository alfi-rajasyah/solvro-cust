import type { Prisma, PrismaClient } from "@prisma/client";
import { HttpError } from "../http/errors.js";
import { filterUsersWhoCanSeeProject } from "./notifications.js";
import { assertUserExists } from "./userRefs.js";

/**
 * An epic's owner must exist (400 `owner_not_found`) and be someone who can
 * see the project: its TAM, a linked customer's owner, a member, or a
 * `project:view-all` holder (400 `owner_no_project_access`). Inactive accounts
 * are not rejected (ISS-029). Shared by PATCH /epics/:id and
 * POST /projects/:id/epics.
 */
export async function assertEpicOwnerCanSeeProject(
  tx: Prisma.TransactionClient | PrismaClient,
  projectId: number,
  ownerId: number,
): Promise<void> {
  await assertUserExists(tx, ownerId, "owner_not_found", "Epic owner not found");
  const visible = await filterUsersWhoCanSeeProject(tx, projectId, [ownerId]);
  if (!visible.has(ownerId)) {
    throw new HttpError(
      400,
      "owner_no_project_access",
      "Epic owner must be the project's TAM, a member, or have access to all projects",
    );
  }
}
