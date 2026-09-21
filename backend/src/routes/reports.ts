import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { computePortfolioRows } from "../lib/portfolio.js";
import { isValidDayString } from "../lib/dateBoundary.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

const executiveQuerySchema = z.object({
  // Caller's local calendar day ("yyyy-MM-dd"), threaded into the
  // portfolio roll-up's isOverdue/daysOverdue — see lib/dateBoundary.ts.
  // Falls back to the server's UTC day when absent.
  today: z
    .string()
    .refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" })
    .optional(),
});

// Intentionally ORG-WIDE: this is the Executive/Manager portfolio roll-up.
// The `report:executive` permission itself is the org-wide read grant, so we
// deliberately do NOT apply projectVisibilityFilter here.
reportsRouter.get(
  "/executive",
  requirePermission("report:executive"),
  validate("query", executiveQuerySchema),
  async (req, res) => {
    const { today } = req.query as unknown as z.infer<typeof executiveQuerySchema>;
    const rows = await computePortfolioRows({}, today);
    res.json({ projects: rows, generatedAt: new Date().toISOString() });
  },
);
