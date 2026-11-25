import { ApiError } from "@/lib/api";
import { hasPermission, type AuthUser } from "@/lib/auth";

// Ownership rules mirrored from the backend's `owner_only` guard
// (docs/archive/plans/collaboration-and-sharing.md, phase 2 decisions):
// access through project membership alone does not allow changing a
// project's TAM or customer, deleting a project, changing a customer's owner,
// or deleting a customer. The server is the authority — these only decide
// which controls to hide so people don't walk into a 403.

/** `project:view-all` (or the wildcard "*") sees and owns everything. */
export function hasViewAll(user: AuthUser | null | undefined): boolean {
  return hasPermission(user, "project:view-all");
}

/**
 * Owner access to a project: view-all, the project's TAM, or the owner of ANY
 * customer the project is linked to (docs/archive/plans/multi-customer-projects.md,
 * decision 4). `customerOwnerIds` are the linked customers' owner ids; a
 * `null` entry is an unowned customer and never matches.
 */
export function canOwnProject(
  user: AuthUser | null | undefined,
  project: { tamId: number },
  customerOwnerIds: readonly (number | null | undefined)[],
): boolean {
  if (!user) return false;
  if (hasViewAll(user)) return true;
  if (project.tamId === user.id) return true;
  return customerOwnerIds.some((id) => id != null && id === user.id);
}

/**
 * Whether the caller may reassign a customer's owner or delete the customer.
 * The server decides (`canChangeOwner` on GET /customers and /customers/:id,
 * the same rule as PATCH and DELETE): view-all, the owner, or — on an
 * unowned customer — the TAM of every project under it, hidden ones included,
 * which the client cannot see. Absent means unknown (a row from a stale
 * cache), treated as not allowed.
 */
export function canChangeCustomerOwner(customer: { canChangeOwner?: boolean }): boolean {
  return customer.canChangeOwner === true;
}

export const OWNER_ONLY_MESSAGE =
  "Only the project's TAM or the owner of one of its customers can do this. Ask them, or an admin.";

/** True for the backend's 403 `owner_only` refusal. */
export function isOwnerOnlyError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false;
  const body = err.body as { code?: unknown } | null;
  return body?.code === "owner_only";
}

/** The message to show for a failed save/delete, with `owner_only` made clear. */
export function saveErrorMessage(err: unknown, fallback: string): string {
  if (isOwnerOnlyError(err)) return OWNER_ONLY_MESSAGE;
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * The message for a failed customer save. An `owner_only` refusal there is
 * the owner-change rule, whose message is specific to the case (owned by
 * someone else, or unowned with other TAMs' projects), so show the server's.
 */
export function customerSaveErrorMessage(err: unknown, fallback: string): string {
  if (isOwnerOnlyError(err)) return (err as ApiError).message;
  return saveErrorMessage(err, fallback);
}
