import type { Prisma, PrismaClient } from "@prisma/client";
import { HttpError } from "../http/errors.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * A user id taken from a request body (a project's TAM, a task's assignee, an
 * epic's owner) must name an existing user. The create routes write these as
 * plain foreign-key columns, so an unknown id used to reach the INSERT and fail
 * there as a 500. Same convention as a body `customerId` (400
 * `customer_not_found`): a 400 with a field-specific code.
 *
 * Existence only: an inactive user is still accepted here, as on the update
 * routes.
 */
export async function assertUserExists(
  db: Tx,
  userId: number,
  code: string,
  message: string,
): Promise<void> {
  const found = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!found) throw new HttpError(400, code, message);
}
