// Authenticated read of the Outline link settings for every signed-in user:
// GET /outline/config -> { baseUrl } (drives the sidebar item and the header
// buttons). Admin writes live in routes/outlineAdmin.ts. No Outline API is
// called here and no token is involved (docs/archive/plans/outline-integration.md).
import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth } from "../http/auth.js";

export const outlineRouter = Router();

outlineRouter.use(requireAuth);

outlineRouter.get("/config", async (_req, res) => {
  const row = await prisma.outlineConfig.findUnique({
    where: { id: "default" },
    select: { baseUrl: true },
  });
  res.json({ baseUrl: row?.baseUrl ?? null });
});
