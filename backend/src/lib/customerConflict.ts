import { Prisma } from "@prisma/client";
import { HttpError } from "../http/errors.js";

export const CUSTOMER_EXISTS_MESSAGE = "A customer with that name already exists";

/**
 * True for the unique violation on a customer's `name` index. The other unique
 * index on the table (`itop_org_id`) does not match: it keeps the generic 409.
 */
export function isCustomerNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const meta = err.meta as { target?: unknown; constraint?: unknown } | undefined;
  const parts = [meta?.target, meta?.constraint].flat().filter((v): v is string => typeof v === "string");
  return parts.some((v) => v === "name" || v === "customers_name_key");
}

export function customerExistsError(): HttpError {
  return new HttpError(409, "customer_exists", CUSTOMER_EXISTS_MESSAGE);
}
