// The Docs tab API (docs/archive/plans/outline-integration.md, B4):
//   GET  /projects/:id/outline/docs   GET  /customers/:id/outline/docs   -> the Outline page tree
//   POST /projects/:id/outline/docs   POST /customers/:id/outline/docs   -> create a page under the link
// The anchor is the project's/customer's own `outlineUrl`; everything runs under
// the VIEWER's Outline token (D2), so the tree only holds pages that user can open.
// Outline page text is never returned (D4). Visibility is the usual 404-first
// ensure*Visible; creating needs the write permission of the entity.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { ensureCustomerVisible, ensureProjectVisible } from "../lib/visibility.js";
import { createOutlineDoc, resolveOutlineAnchor, type ResolvedAnchor } from "../lib/outline/docs.js";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const createDocSchema = z.object({
  title: z.string().trim().min(1).max(255),
  templateId: z.string().uuid().optional(),
  parentDocumentId: z.string().uuid().optional(),
  publish: z.boolean(),
});

function present(anchor: ResolvedAnchor) {
  switch (anchor.state) {
    case "none":
      return { anchor: null };
    case "outside":
      return { anchor: { outside: true } };
    case "unsupported":
      return { anchor: { unsupported: true } };
    case "hidden":
      return { anchor: { hidden: true } };
    case "ok":
      return { anchor: { kind: anchor.kind, title: anchor.title, url: anchor.url }, tree: anchor.tree };
  }
}

export const projectOutlineDocsRouter = Router();
projectOutlineDocsRouter.use(requireAuth);

projectOutlineDocsRouter.get(
  "/:id/outline/docs",
  requirePermission("project:read"),
  validate("params", paramsSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof paramsSchema>;
    await ensureProjectVisible(req.user!, id);
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, select: { outlineUrl: true } });
    res.set("Cache-Control", "no-store");
    res.json(present(await resolveOutlineAnchor(req.user!.sub, project.outlineUrl)));
  },
);

projectOutlineDocsRouter.post(
  "/:id/outline/docs",
  requirePermission("project:write"),
  validate("params", paramsSchema),
  validate("body", createDocSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof paramsSchema>;
    await ensureProjectVisible(req.user!, id);
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, select: { outlineUrl: true } });
    const created = await createOutlineDoc(req.user!.sub, project.outlineUrl, req.body as z.infer<typeof createDocSchema>);
    res.status(201).json(created);
  },
);

export const customerOutlineDocsRouter = Router();
customerOutlineDocsRouter.use(requireAuth);

customerOutlineDocsRouter.get(
  "/:id/outline/docs",
  requirePermission("project:read"),
  validate("params", paramsSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof paramsSchema>;
    await ensureCustomerVisible(req.user!, id);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id }, select: { outlineUrl: true } });
    res.set("Cache-Control", "no-store");
    res.json(present(await resolveOutlineAnchor(req.user!.sub, customer.outlineUrl)));
  },
);

customerOutlineDocsRouter.post(
  "/:id/outline/docs",
  requirePermission("project:write"),
  validate("params", paramsSchema),
  validate("body", createDocSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof paramsSchema>;
    await ensureCustomerVisible(req.user!, id);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id }, select: { outlineUrl: true } });
    const created = await createOutlineDoc(req.user!.sub, customer.outlineUrl, req.body as z.infer<typeof createDocSchema>);
    res.status(201).json(created);
  },
);
