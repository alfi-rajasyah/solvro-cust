import { Router } from "express";
import { requireAuth, requirePermission } from "../http/auth.js";
import { listTaskStatusDefs } from "../lib/taskStatuses.js";

// Read side of the workspace-wide task status list
// (docs/archive/plans/custom-task-statuses.md §2). The whole-list save is
// PUT /admin/task-statuses (routes/admin.ts).
export const taskStatusesRouter = Router();

taskStatusesRouter.use(requireAuth, requirePermission("project:read"));

taskStatusesRouter.get("/", async (_req, res) => {
  res.json(await listTaskStatusDefs());
});
