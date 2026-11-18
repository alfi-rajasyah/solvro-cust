import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";

// Project-scoping is permission-based, NOT role-name based. `project:view-all`
// (which "*" also satisfies via hasPermission) grants global visibility;
// everyone else sees the projects they're attached to as the assigned TAM
// on the project row, every project of a customer they own as TAM
// (`Customer.tamId` — user decision 2026-08-31, so the Daily Review's
// owned-customer groups are actionable, not read-only), and every project
// they were added to as a member (`ProjectMember` — user decision 2026-09-29,
// docs/archive/plans/collaboration-and-sharing.md; members get the same full
// access as the TAM, and task assignment adds one automatically). Admin grants
// broader access by adding "project:view-all" (or "*") to a role's permissions
// in Admin > Roles.
//
// The result's only top-level key is `OR`. AND-compose (never object-spread)
// when combining it with a sibling `OR` condition.
//
// These helpers live here (not in a route file) so any router can import them
// without taking a dependency on routes/projects.ts — avoiding the circular
// import that arises when projects.ts itself needs to import sibling routes.
//
// `{ viaMembership: false }` drops the member arm: it is the rule for actions
// that membership alone must not allow (changing a project's TAM or customer,
// deleting a project, changing/deleting a customer — see the *OwnerAccess
// helpers below).
//
// TWO REPRESENTATIONS OF THE SAME RULE live side by side below:
// `projectVisibilityFilter` (a Prisma `where`, used by every route) and
// `canUserSeeProject` (the same arms as a pure predicate over already-loaded
// project facts, used where many users are checked against ONE project in a
// fixed number of queries — lib/notifications.ts). Any change to the arms
// (a new way to see a project) must be made in BOTH; test/notifications.test.ts
// compares them for the arms that exist today, so extend that test with any
// new arm.
export interface VisibilityOptions {
  viaMembership?: boolean;
  /**
   * Customer filter only: the caller is asking "do I OWN this?", not "can I
   * see this?". Skips the `customer:view-all` short-circuit, because that
   * permission grants visibility, never ownership. Independent of
   * `viaMembership`, so a future membership-excluding READ check keeps
   * `customer:view-all`.
   */
  ownership?: boolean;
}

export function projectVisibilityFilter(
  user: JwtPayload,
  opts: VisibilityOptions = {},
): Prisma.ProjectWhereInput {
  if (hasPermission(user, "project:view-all")) return {};
  const arms: Prisma.ProjectWhereInput[] = [
    { tamId: user.sub },
    // Any linked customer (docs/archive/plans/multi-customer-projects.md): a
    // shared project is visible to the owner of every customer it belongs to.
    { customers: { some: { customer: { tamId: user.sub } } } },
  ];
  if (opts.viaMembership !== false) {
    arms.push({ members: { some: { userId: user.sub } } });
  }
  return { OR: arms };
}

/** What `canUserSeeProject` needs to know about one project. */
export interface ProjectVisibilityFacts {
  tamId: number | null;
  /** `Customer.tamId` of every customer linked to the project (unowned ones omitted). */
  customerTamIds: ReadonlySet<number>;
  /** Members among the users being checked (or all members). */
  memberIds: ReadonlySet<number>;
}

/**
 * Pure counterpart of `projectVisibilityFilter(user)` for one project whose
 * facts are already loaded: view-all, the project's TAM, the owner of any
 * linked customer, or a member. Keep the two in step (see the note above them).
 */
export function canUserSeeProject(user: JwtPayload, project: ProjectVisibilityFacts): boolean {
  return (
    hasPermission(user, "project:view-all") ||
    project.tamId === user.sub ||
    project.customerTamIds.has(user.sub) ||
    project.memberIds.has(user.sub)
  );
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

// Owner-only gate (user decision 2026-09-30, docs/archive/plans/collaboration-and-sharing.md):
// membership alone must not allow changing a project's TAM or customer or
// deleting it. Visibility first (404, as everywhere), then 403 `owner_only`
// when the caller can see the project only through membership.
export async function ensureProjectOwnerAccess(
  user: JwtPayload,
  projectId: number,
): Promise<void> {
  await ensureProjectVisible(user, projectId);
  const owned = await prisma.project.findFirst({
    where: { id: projectId, ...projectVisibilityFilter(user, { viaMembership: false }) },
    select: { id: true },
  });
  if (!owned) {
    throw new HttpError(403, "owner_only", "Only the project's TAM can do this");
  }
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

// Customer-scoping (docs/archive/plans/customer-visibility-spec.md §3, Decisions 1-2):
// `project:view-all` (or "*") sees every customer, as does `customer:view-all`
// (visibility, and the writes that follow visibility — never ownership; see below). Everyone else sees a
// customer when they own it (`Customer.tamId`), when nobody owns it
// (`tamId: null` — unowned customers stay visible to all, as before the
// rule existed), or when at least one of its projects is visible to them
// via projectVisibilityFilter — so a project's TAM (or member) can always
// reach the customer behind a project they can open. Hidden = owned by another TAM
// with no project of the caller's.
//
// The result's only top-level key is `OR`. AND-compose (never object-spread)
// when combining it with a sibling `OR` condition, or the visibility arms
// are silently overwritten with no type error.
//
// The third arm reuses projectVisibilityFilter as the single source of the
// project rule. Its own owned-customer arm is redundant here (a project whose
// customer is this customer, owned by me, is already arm 1) — kept for one
// source of truth over one saved join. `projects` is the ProjectCustomer join:
// the customer is visible when ANY of its linked projects is.
export function customerVisibilityFilter(
  user: JwtPayload,
  opts: VisibilityOptions = {},
): Prisma.CustomerWhereInput {
  if (hasPermission(user, "project:view-all")) return {};
  // `customer:view-all` (user decision 2026-11-03) widens customer visibility
  // — and with it the customer sub-resource writes that follow visibility —
  // never ownership. Owner checks pass `{ ownership: true }`, skip this
  // short-circuit and fall through to the arms below. Projects stay gated by
  // projectVisibilityFilter.
  if (!opts.ownership && hasPermission(user, "customer:view-all")) return {};
  return {
    OR: [
      { tamId: user.sub },
      { tamId: null },
      // Plain visibility: any project the caller can see. An OWNER check
      // (`ownership`) narrows this to projects the caller is TAM of: the owner
      // of one linked customer owns the shared PROJECT, never the other
      // customer (docs/archive/plans/multi-customer-projects.md, decision 4).
      opts.ownership
        ? { projects: { some: { project: { tamId: user.sub } } } }
        : { projects: { some: { project: projectVisibilityFilter(user, opts) } } },
    ],
  };
}

// Boolean primitive: does this customer exist AND fall inside the caller's
// visibility? Routes that take a customerId as a body field (POST /projects,
// PATCH /projects/:id) use it directly and answer 400 `customer_not_found`
// — a bad field, not a missing resource.
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

// Batch form of `isCustomerVisible` for a project's customer links: true when
// EVERY id exists and is visible to the caller (one count query).
export async function areCustomersVisible(
  user: JwtPayload,
  customerIds: readonly number[],
): Promise<boolean> {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return true;
  const count = await prisma.customer.count({
    where: { AND: [customerVisibilityFilter(user), { id: { in: ids } }] },
  });
  return count === ids.length;
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

// Owner-only gate for customers: changing a customer's owner or deleting it
// needs the access a non-member had before project members existed (owner,
// unowned customer, a project the caller is TAM of, or `project:view-all`).
// 404 first, then 403 `owner_only` for a caller who sees it only through a
// project membership.
export async function ensureCustomerOwnerAccess(
  user: JwtPayload,
  customerId: number,
): Promise<void> {
  await ensureCustomerVisible(user, customerId);
  const owned = await prisma.customer.findFirst({
    where: { id: customerId, ...customerVisibilityFilter(user, { viaMembership: false, ownership: true }) },
    select: { id: true },
  });
  if (!owned) {
    throw new HttpError(403, "owner_only", "Only the customer's owner can do this");
  }
}
