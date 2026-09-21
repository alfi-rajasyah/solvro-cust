import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";

// Project-scoping is permission-based, NOT role-name based. `project:view-all`
// (which "*" also satisfies via hasPermission) grants global visibility;
// everyone else sees the projects they're attached to as the assigned TAM
// or SA on the project row, plus every project of a customer they own as
// TAM (`Customer.tamId` — user decision 2026-08-31, so the Daily Review's
// owned-customer groups are actionable, not read-only). Admin grants broader
// access by adding "project:view-all" (or "*") to a role's permissions in
// Admin > Roles.
//
// The result's only top-level key is `OR`. AND-compose (never object-spread)
// when combining it with a sibling `OR` condition.
//
// These helpers live here (not in a route file) so any router can import them
// without taking a dependency on routes/projects.ts — avoiding the circular
// import that arises when projects.ts itself needs to import sibling routes.
export function projectVisibilityFilter(user: JwtPayload): Prisma.ProjectWhereInput {
  if (hasPermission(user, "project:view-all")) return {};
  return {
    OR: [
      { tamId: user.sub },
      { saId: user.sub },
      { customer: { tamId: user.sub } },
    ],
  };
}

// 404-if-not-visible preamble for project-nested routes. Extracted so new
// project-scoped routes can't accidentally skip the visibility check while
// still passing the permission gate. Returns 404 (not 403) on purpose — don't
// tell the caller a project exists if they shouldn't see it.
export async function ensureProjectVisible(
  user: JwtPayload,
  projectId: number,
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectVisibilityFilter(user) },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, "not_found", "Project not found");
}

// Same idea for routes that key off a task id and need to verify the caller can
// see the parent project (tasks.ts PATCH/DELETE/comments).
export async function ensureTaskVisible(
  user: JwtPayload,
  taskId: number,
): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, project: projectVisibilityFilter(user) },
    select: { id: true },
  });
  if (!task) throw new HttpError(404, "not_found", "Task not found");
}

// Customer-scoping (docs/plans/customer-visibility-spec.md §3, Decisions 1-2):
// `project:view-all` (or "*") sees every customer. Everyone else sees a
// customer when they own it (`Customer.tamId`), when nobody owns it
// (`tamId: null` — unowned customers stay visible to all, as before the
// rule existed), or when at least one of its projects is visible to them
// via projectVisibilityFilter — so an SA or a project TAM can always reach
// the customer behind a project they can open. Hidden = owned by another
// TAM with no project of the caller's.
//
// The result's only top-level key is `OR`. AND-compose (never object-spread)
// when combining it with a sibling `OR` condition, or the visibility arms
// are silently overwritten with no type error.
//
// The third arm reuses projectVisibilityFilter as the single source of the
// project rule. Its own owned-customer arm is redundant here (a project whose
// customer is this customer, owned by me, is already arm 1) — kept for one
// source of truth over one saved join.
export function customerVisibilityFilter(user: JwtPayload): Prisma.CustomerWhereInput {
  if (hasPermission(user, "project:view-all")) return {};
  return {
    OR: [
      { tamId: user.sub },
      { tamId: null },
      { projects: { some: projectVisibilityFilter(user) } },
    ],
  };
}

// Boolean primitive: does this customer exist AND fall inside the caller's
// visibility? Routes that take a customerId as a body field (POST /projects,
// PATCH /projects/:id, the opportunity handoff) use it directly and answer
// 400 `customer_not_found` — a bad field, not a missing resource.
export async function isCustomerVisible(
  user: JwtPayload,
  customerId: number,
): Promise<boolean> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, ...customerVisibilityFilter(user) },
    select: { id: true },
  });
  return customer !== null;
}

// 404-if-not-visible preamble for customer-keyed routes (notes, weekly
// updates, services, PATCH/DELETE). Same 404-not-403 reasoning as
// ensureProjectVisible. Keeps the `customer_not_found` code the customer
// routes have always returned on an unknown id (asserted in
// backend/test/customerNotes.test.ts).
export async function ensureCustomerVisible(
  user: JwtPayload,
  customerId: number,
): Promise<void> {
  if (!(await isCustomerVisible(user, customerId))) {
    throw new HttpError(404, "customer_not_found", "Customer not found");
  }
}
