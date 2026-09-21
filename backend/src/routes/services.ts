import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const createServiceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  active: z.boolean().optional(),
});

const updateServiceSchema = createServiceSchema.partial();

export const servicesRouter = Router();

servicesRouter.use(requireAuth);

servicesRouter.get("/", async (_req, res) => {
  const services = await prisma.service.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  res.json(services);
});

servicesRouter.post(
  "/",
  requirePermission("project:write"),
  validate("body", createServiceSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createServiceSchema>;
    const service = await prisma.service.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        active: body.active ?? true,
      },
    });
    res.status(201).json(service);
  },
);

servicesRouter.patch(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", updateServiceSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateServiceSchema>;
    const updated = await prisma.service.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && {
          description: body.description || null,
        }),
        ...(body.active !== undefined && { active: body.active }),
      },
    });
    res.json(updated);
  },
);

servicesRouter.delete(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await prisma.service.delete({ where: { id } });
    res.status(204).end();
  },
);
