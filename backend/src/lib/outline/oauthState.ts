// Housekeeping for the single-use OAuth `state` rows (OutlineOAuthState,
// docs/archive/plans/outline-integration.md F12). The OAuth routes create a row
// per started connection and delete it on use; a flow the user abandons leaves
// the row behind, so it is purged opportunistically (the start route calls this
// before inserting) rather than by a scheduler.
import { prisma } from "../../prisma.js";

/** How long a started OAuth flow stays valid. */
export const OUTLINE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Deletes every state row whose `expiresAt` has passed; returns how many. */
export async function purgeExpiredOutlineStates(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.outlineOAuthState.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
