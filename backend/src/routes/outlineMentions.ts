// "Mentioned in Outline": GET /tasks/:id/outline-mentions and
// GET /projects/:id/outline-mentions (docs/archive/plans/outline-integration.md,
// D4 / D5 / B5). Rows are written by the Outline webhook (routes/webhook.ts); this
// router only reads them. Titles are shown only for pages the VIEWER's own Outline
// token can open (lib/outline/mentionsAccess.ts) - every other page counts toward
// `hiddenCount` without revealing a title. A viewer without an Outline connection
// gets only the total, never a title.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible, ensureTaskVisible } from "../lib/visibility.js";
import { checkDocsVisible } from "../lib/outline/mentionsAccess.js";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

// Verifying visibility costs one Outline call per page (shared rate limits, F11):
// only the newest pages are checked; any beyond the cap are reported as hidden.
const MAX_DOCS_CHECKED = 50;

export interface OutlineMentionsResponse {
  connected: boolean;
  /** Only when `connected` is false: the number of pages that mention this, no titles. */
  total?: number;
  visible?: Array<{ docId: string; title: string; url: string }>;
  hiddenCount?: number;
}

async function buildResponse(userId: number, where: Prisma.OutlineMentionWhereInput): Promise<OutlineMentionsResponse> {
  const [rows, config, user] = await Promise.all([
    prisma.outlineMention.findMany({
      where,
      select: { outlineDocId: true, docTitle: true, docPath: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
    prisma.outlineConfig.findUnique({ where: { id: "default" }, select: { baseUrl: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { outlineAccessTokenEnc: true } }),
  ]);

  // A page that links both the project and one of its tasks is one page.
  const docs = new Map<string, { title: string; path: string }>();
  for (const row of rows) {
    if (!docs.has(row.outlineDocId)) docs.set(row.outlineDocId, { title: row.docTitle, path: row.docPath });
  }
  const total = docs.size;

  const baseUrl = config?.baseUrl?.replace(/\/+$/, "") ?? null;
  if (total === 0) return { connected: baseUrl !== null && user?.outlineAccessTokenEnc != null, visible: [], hiddenCount: 0 };
  if (baseUrl === null || !user?.outlineAccessTokenEnc) return { connected: false, total };

  const ids = [...docs.keys()];
  const checked = ids.slice(0, MAX_DOCS_CHECKED);
  const verdicts = await checkDocsVisible(userId, checked);
  // A refused/expired token is a disconnected viewer, not a hidden page.
  if ([...verdicts.values()].includes("reconnect")) return { connected: false, total };

  const visible = checked
    .filter((id) => verdicts.get(id) === "visible")
    .map((id) => ({ docId: id, title: docs.get(id)!.title, url: baseUrl + docs.get(id)!.path }));
  return { connected: true, visible, hiddenCount: total - visible.length };
}

function noStore(res: import("express").Response): void {
  res.set("Cache-Control", "private, no-store");
}

// Both routers need `project:read` like the rest of the project surface
// (outlineDocs.ts, projects.ts): visibility alone let a member with no
// permissions read mention counts and titles.
export const taskOutlineMentionsRouter = Router();
taskOutlineMentionsRouter.use(requireAuth, requirePermission("project:read"));

taskOutlineMentionsRouter.get(
  "/:id/outline-mentions",
  validate("params", paramsSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof paramsSchema>;
    await ensureTaskVisible(req.user!, id);
    noStore(res);
    res.json(await buildResponse(req.user!.sub, { taskId: id }));
  },
);

export const projectOutlineMentionsRouter = Router();
projectOutlineMentionsRouter.use(requireAuth, requirePermission("project:read"));

projectOutlineMentionsRouter.get(
  "/:id/outline-mentions",
  validate("params", paramsSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof paramsSchema>;
    await ensureProjectVisible(req.user!, id);
    noStore(res);
    // Project-level read: the project's own links plus links to any of its tasks.
    res.json(await buildResponse(req.user!.sub, { OR: [{ projectId: id }, { task: { projectId: id } }] }));
  },
);
