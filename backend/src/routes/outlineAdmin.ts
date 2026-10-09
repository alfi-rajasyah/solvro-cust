// Admin API for the Outline link settings: GET/PATCH /admin/settings/outline
// (the deployment's Outline base URL). Its own router (not folded into
// routes/admin.ts, a spine file), mirroring routes/itopAdmin.ts. Phase A stores
// a URL only — no token of any kind (docs/archive/plans/outline-integration.md).
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requireAdmin } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { outlineUrlSchema } from "../lib/outlineUrl.js";

export const outlineAdminRouter = Router();

outlineAdminRouter.use(requireAuth, requireAdmin);

const SINGLETON = { id: "default" } as const;
const withUpdater = {
  updatedBy: { select: { id: true, username: true } },
} satisfies Prisma.OutlineConfigInclude;

async function loadConfig() {
  try {
    return await prisma.outlineConfig.upsert({
      where: SINGLETON,
      create: SINGLETON,
      update: {},
      include: withUpdater,
    });
  } catch (err) {
    // Two first-ever concurrent reads can race on the upsert; the loser re-reads.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.outlineConfig.findUniqueOrThrow({ where: SINGLETON, include: withUpdater });
    }
    throw err;
  }
}

function serialize(row: Awaited<ReturnType<typeof loadConfig>>) {
  return { baseUrl: row.baseUrl, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}

outlineAdminRouter.get("/", async (_req, res) => {
  res.json(serialize(await loadConfig()));
});

// The base URL is shown to every signed-in user and is the Outline origin a
// later phase allows to frame Solvro, so it is a plain address: no login,
// query string or fragment.
const updateOutlineSettingsSchema = z.object({
  baseUrl: outlineUrlSchema.refine(
    (v) => {
      // Zod still runs this after the shared rule rejected the value, so
      // anything but a string has already failed — don't throw on it.
      if (typeof v !== "string") return true;
      try {
        const u = new URL(v);
        return u.username === "" && u.password === "" && u.search === "" && u.hash === "";
      } catch {
        return false;
      }
    },
    { message: "The Outline address must not contain a login, query string or fragment" },
  ),
});

outlineAdminRouter.patch("/", validate("body", updateOutlineSettingsSchema), async (req, res) => {
  const { baseUrl } = req.body as z.infer<typeof updateOutlineSettingsSchema>;
  await loadConfig(); // make sure the singleton exists
  const row = await prisma.outlineConfig.update({
    where: SINGLETON,
    data: { baseUrl: baseUrl === null ? null : baseUrl.replace(/\/+$/, ""), updatedById: req.user!.sub },
    include: withUpdater,
  });
  res.json(serialize(row));
});
