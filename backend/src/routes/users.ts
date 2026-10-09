import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";

export const usersRouter = Router();

// The in-app people directory (assignee, member and @mention pickers).
// Gate (2026-10 security hardening): a caller needs `project:read` — a
// PENDING account (no permissions) used to list every user here. The
// response carries what the pickers need and no access map: the role's
// permission list is not returned.
usersRouter.use(requireAuth, requirePermission("project:read"));

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      active: true,
      avatarUrl: true,
      role: { select: { roleName: true } },
    },
    orderBy: { username: "asc" },
  });
  res.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      active: u.active,
      avatarUrl: u.avatarUrl,
      role: u.role.roleName,
    })),
  );
});
