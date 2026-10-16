import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { customerVisibilityFilter, projectVisibilityFilter } from "../lib/visibility.js";

const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    // Prisma passes `contains` straight into the ILIKE pattern; escape LIKE
    // metacharacters so a literal "%" or "_" doesn't become a wildcard.
    .transform((s) => s.replace(/[\\%_]/g, (c) => `\\${c}`)),
});

// 8 hits per group keeps the palette scannable and the three queries cheap
// (sub-200ms NFR). ProjectNote is deliberately NOT searched — INTERNAL-notes
// guardrail; notes must never leak through a search surface.
const GROUP_LIMIT = 8;

export const searchRouter = Router();

// `project:read` gate (2026-10 security hardening): a PENDING account (no
// permissions) used to search unowned customers here.
searchRouter.use(requireAuth, requirePermission("project:read"));

searchRouter.get("/", validate("query", searchQuerySchema), async (req, res) => {
  const { q } = req.query as unknown as z.infer<typeof searchQuerySchema>;
  const visible = projectVisibilityFilter(req.user!);

  const [projects, tasks, customers] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [visible, { name: { contains: q, mode: "insensitive" } }] },
      select: {
        id: true,
        name: true,
        status: true,
        customer: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: GROUP_LIMIT,
    }),
    prisma.task.findMany({
      // Subtasks are excluded from search v1 — a palette row can't convey a
      // parent, and the ?task= deep-link is only proven for top-level tasks
      // (mirrors the topLevel=true convention in tasks.ts).
      where: {
        title: { contains: q, mode: "insensitive" },
        project: visible,
        parentTaskId: null,
      },
      select: {
        id: true,
        title: true,
        status: true,
        projectId: true,
        project: { select: { name: true } },
      },
      orderBy: { title: "asc" },
      take: GROUP_LIMIT,
    }),
    prisma.customer.findMany({
      // Customer Visibility (docs/plans/customer-visibility-spec.md §5.4,
      // Decision 11): a search hit must obey the same rule as every other
      // customer read — a customer owned by another TAM with no project of
      // the caller's must not surface here either.
      where: { AND: [customerVisibilityFilter(req.user!), { name: { contains: q, mode: "insensitive" } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: GROUP_LIMIT,
    }),
  ]);

  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      customerName: p.customer?.name ?? null,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      projectId: t.projectId,
      projectName: t.project.name,
    })),
    customers,
  });
});
