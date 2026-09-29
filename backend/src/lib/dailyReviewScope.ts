import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, type JwtPayload } from "../http/auth.js";
import { customerVisibilityFilter, projectVisibilityFilter } from "./visibility.js";

// The Daily Review customer/project scope (customer-visibility-spec.md §5.3,
// Decisions 8-10), shared by GET /daily-review and GET /overview/badges so the
// page and the sidebar badge can never disagree about what is "in scope".
// Two batched queries regardless of how many customers/projects match.

/**
 * Resolves who and what a caller's Daily Review covers.
 *
 * `customers` — a TAM's owned customers (tamId = me; view-all: every customer
 * with a TAM set) plus any customer with at least one ACTIVE project visible
 * to the caller (the "attached" tier, via projectVisibilityFilter so a project
 * TAM on someone else's customer still reaches it). AND-composed (not
 * object-spread) so customerVisibilityFilter's own keys can never collide with
 * or be silently overwritten by a sibling condition.
 *
 * `projects` — ACTIVE projects in scope (Decision 9). Owned customer → every
 * ACTIVE project of that customer, whoever the project TAM is. Attached
 * customer → only the caller's own ACTIVE projects. Decision 10: ACTIVE
 * projects with customerId: null and Project.tamId = me (the "No customer"
 * group).
 */
export async function resolveDailyReviewScope(user: JwtPayload) {
  // hasPermission treats "*" as satisfying every permission check, so this
  // single predicate also covers wildcard (ADMIN) users — see
  // lib/visibility.ts's projectVisibilityFilter, which the same check
  // gates internally.
  const viewAll = hasPermission(user, "project:view-all");

  const customerWhere: Prisma.CustomerWhereInput = {
    AND: [
      customerVisibilityFilter(user),
      {
        OR: [
          viewAll ? { tamId: { not: null } } : { tamId: user.sub },
          {
            projects: {
              some: { AND: [{ status: "ACTIVE" }, projectVisibilityFilter(user)] },
            },
          },
        ],
      },
    ],
  };

  const candidateCustomers = await prisma.customer.findMany({
    where: customerWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tam: { select: { id: true, username: true } },
    },
  });
  const candidateCustomerIds = candidateCustomers.map((c) => c.id);

  // Decision 9: split into owned (tamId = me; view-all: every customer
  // resolved above) vs. attached (visible only through a project) — the
  // project query below treats the two tiers differently, and the prune
  // further down uses ownedIdSet to decide which attached customers
  // actually survive.
  const ownedIds = viewAll
    ? candidateCustomerIds
    : candidateCustomers.filter((c) => c.tam?.id === user.sub).map((c) => c.id);
  const ownedIdSet = new Set(ownedIds);
  const attachedIds = candidateCustomerIds.filter((id) => !ownedIdSet.has(id));

  const projectWhere: Prisma.ProjectWhereInput = viewAll
    ? { status: "ACTIVE" }
    : {
        AND: [
          { status: "ACTIVE" },
          {
            OR: [
              { customerId: { in: ownedIds } },
              { tamId: user.sub, customerId: { in: attachedIds } },
              { tamId: user.sub, customerId: null },
            ],
          },
        ],
      };

  const projects = await prisma.project.findMany({
    where: projectWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      customerId: true,
      baselineLockedAt: true,
    },
  });

  // Decision 9 (fix): an ATTACHED customer surfaces only when it actually
  // has a project in the result above — the customer query's "attached"
  // OR arm admits a customer via ANY project matching
  // projectVisibilityFilter, while the project query only pulls the
  // caller's own (tamId) projects for an attached customer. Without this
  // prune, a customer the caller can't actually see any project of would
  // render as an empty group and inflate coverage.total. Owned customers
  // always stay, even with zero active projects — they still carry
  // operations notes and the weekly update (Decision 8).
  const projectCustomerIds = new Set(
    projects.map((p) => p.customerId).filter((id): id is number => id !== null),
  );
  const customers = candidateCustomers.filter(
    (c) => ownedIdSet.has(c.id) || projectCustomerIds.has(c.id),
  );

  return { customers, projects };
}
