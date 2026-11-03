import { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../http/errors.js";

// Project <-> customer links (docs/archive/plans/multi-customer-projects.md).
// A project belongs to zero or more customers with at most one primary.
// Visibility and ownership go through ANY link (lib/visibility.ts); breadcrumbs,
// guest pages and portfolio rows use the primary.

/** Prisma include shared by every project response that carries customers. */
export const projectCustomersInclude = {
  customers: {
    orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }, { customerId: "asc" }],
    select: {
      isPrimary: true,
      customer: { select: { id: true, name: true, tamId: true } },
    },
  },
} satisfies Prisma.ProjectInclude;

type LinkRow = Prisma.ProjectCustomerGetPayload<{
  select: (typeof projectCustomersInclude)["customers"]["select"];
}>;

export interface ProjectCustomerDto {
  id: number;
  name: string;
  tamId: number | null;
  isPrimary: boolean;
}

/**
 * Replaces the raw `customers` join rows of a project with the API shape:
 * `customers[]` (primary first), `primaryCustomer`, and the legacy
 * `customerId` / `customer` (= the primary), kept for one release so the
 * frontend can move over.
 */
export function withProjectCustomers<T extends { customers: LinkRow[] }>(project: T) {
  const customers: ProjectCustomerDto[] = project.customers.map((l) => ({
    id: l.customer.id,
    name: l.customer.name,
    tamId: l.customer.tamId,
    isPrimary: l.isPrimary,
  }));
  const primary = customers.find((c) => c.isPrimary) ?? null;
  return {
    ...project,
    customers,
    primaryCustomer: primary,
    customerId: primary?.id ?? null,
    customer: primary ? { id: primary.id, name: primary.name, tamId: primary.tamId } : null,
  };
}

export const customerLinkSchema = z.object({
  id: z.number().int().positive(),
  isPrimary: z.boolean(),
});

/** At least one link, unique customers, exactly one primary. */
export const customerLinksSchema = z
  .array(customerLinkSchema)
  .min(1)
  .max(50)
  .superRefine((links, ctx) => {
    if (new Set(links.map((l) => l.id)).size !== links.length) {
      ctx.addIssue({ code: "custom", message: "customers must be unique" });
    }
    if (links.filter((l) => l.isPrimary).length !== 1) {
      ctx.addIssue({ code: "custom", message: "exactly one customer must be primary" });
    }
  });

export interface CustomerLinkInput {
  id: number;
  isPrimary: boolean;
}

/** POST: `customers` wins; the legacy `customerId` maps to a single primary link. */
export function linksFromBody(body: {
  customers?: CustomerLinkInput[];
  customerId?: number;
}): CustomerLinkInput[] | undefined {
  if (body.customers !== undefined) return body.customers;
  if (body.customerId !== undefined) return [{ id: body.customerId, isPrimary: true }];
  return undefined;
}

/**
 * PATCH: `customers` replaces the set. The legacy `customerId` (which the
 * current form re-sends on every save) never removes a link: the current
 * primary -> no change (undefined); another linked customer -> becomes the
 * primary; a new customer -> added as the primary, the old primary demoted,
 * the rest kept.
 */
export function patchLinks(
  body: { customers?: CustomerLinkInput[]; customerId?: number },
  current: { customerId: number; isPrimary: boolean }[],
): CustomerLinkInput[] | undefined {
  if (body.customers !== undefined) return body.customers;
  if (body.customerId === undefined) return undefined;
  const target = body.customerId;
  if (current.some((c) => c.customerId === target && c.isPrimary)) return undefined;
  const kept = current
    .filter((c) => c.customerId !== target)
    .map((c) => ({ id: c.customerId, isPrimary: false }));
  return [{ id: target, isPrimary: true }, ...kept];
}

type Tx = Prisma.TransactionClient;

/**
 * Makes the project's link set equal `links`: removes dropped customers, adds
 * new ones (addedAt = now, so the "oldest link" promotion rule stays stable),
 * and moves the primary flag. Clears the old primary first so the partial
 * unique index (one primary per project) is never violated mid-write.
 */
export async function syncProjectCustomers(
  tx: Tx,
  projectId: number,
  links: CustomerLinkInput[],
): Promise<void> {
  try {
    await syncLinks(tx, projectId, links);
  } catch (e) {
    // A concurrent customer delete (FK) or a racing primary change (unique
    // index) is a conflict the caller can retry, not a server error.
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2002" || e.code === "P2003")) {
      throw new HttpError(409, "project_customers_conflict", "The project's customers changed; try again");
    }
    throw e;
  }
}

async function syncLinks(tx: Tx, projectId: number, links: CustomerLinkInput[]): Promise<void> {
  const existing = await tx.projectCustomer.findMany({
    where: { projectId },
    select: { customerId: true, isPrimary: true },
  });
  const wanted = new Map(links.map((l) => [l.id, l.isPrimary]));
  const have = new Map(existing.map((l) => [l.customerId, l.isPrimary]));

  const removed = existing.filter((l) => !wanted.has(l.customerId)).map((l) => l.customerId);
  if (removed.length > 0) {
    await tx.projectCustomer.deleteMany({ where: { projectId, customerId: { in: removed } } });
  }
  // Drop the primary flag from every kept link that should no longer carry it.
  const demote = existing
    .filter((l) => wanted.has(l.customerId) && l.isPrimary && !wanted.get(l.customerId))
    .map((l) => l.customerId);
  if (demote.length > 0) {
    await tx.projectCustomer.updateMany({
      where: { projectId, customerId: { in: demote } },
      data: { isPrimary: false },
    });
  }
  for (const l of links) {
    if (!have.has(l.id)) {
      await tx.projectCustomer.create({
        data: { projectId, customerId: l.id, isPrimary: l.isPrimary },
      });
    } else if (l.isPrimary && !have.get(l.id)) {
      await tx.projectCustomer.update({
        where: { projectId_customerId: { projectId, customerId: l.id } },
        data: { isPrimary: true },
      });
    }
  }
}

/** Sorted customer names of a project, as logged in the activity feed. */
export async function linkedCustomerNames(tx: Tx, projectId: number): Promise<string[]> {
  const rows = await tx.projectCustomer.findMany({
    where: { projectId },
    select: { customer: { select: { name: true } } },
  });
  return rows.map((r) => r.customer.name).sort((a, b) => a.localeCompare(b));
}

export function customerNotFound(): HttpError {
  return new HttpError(400, "customer_not_found", "Customer not found");
}
