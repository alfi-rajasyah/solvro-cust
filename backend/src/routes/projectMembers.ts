import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureProjectVisible } from "../lib/visibility.js";
import { recordActivity } from "../lib/activity.js";
import { lockProjectOrder } from "../lib/orderLock.js";

// Project members (docs/archive/plans/collaboration-and-sharing.md, C1): people
// added to a project besides its TAM, with the same full access as the TAM
// (lib/visibility.ts, member arm). The TAM, members, customer owners and
// `project:view-all` users can all manage the list — whoever can see the
// project. Mounted on /projects next to projectsRouter (kept out of that file).

const projectParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const memberParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});
const addMemberSchema = z.object({ userId: z.number().int().positive() });

const memberSelect = {
  userId: true,
  createdAt: true,
  user: { select: { username: true, email: true, avatarUrl: true } },
  addedBy: { select: { id: true, username: true } },
} as const;

type MemberRow = {
  userId: number;
  createdAt: Date;
  user: { username: string; email: string; avatarUrl: string | null };
  addedBy: { id: number; username: string } | null;
};

function toMemberDto(m: MemberRow, assignedTaskCount = 0) {
  return {
    userId: m.userId,
    username: m.user.username,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    addedAt: m.createdAt.toISOString(),
    addedBy: m.addedBy,
    assignedTaskCount,
  };
}

// 404 for a project the caller cannot see comes before any body validation, so
// a hidden project cannot be told apart from a missing one by a 400.
async function requireVisibleProject(req: Request, _res: Response, next: NextFunction) {
  const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
  await ensureProjectVisible(req.user!, id);
  next();
}

function countAssigned(projectId: number, userId: number): Promise<number> {
  return prisma.task.count({ where: { projectId, assignedToId: userId } });
}

export const projectMembersRouter = Router();

projectMembersRouter.use(requireAuth);

projectMembersRouter.get(
  "/:id/members",
  requirePermission("project:read"),
  validate("params", projectParamsSchema),
  requireVisibleProject,
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
    const members = await prisma.projectMember.findMany({
      // The TAM is never a member row, but exclude it defensively in case the
      // project's TAM was reassigned to someone who already was a member.
      where: { projectId: id, user: { projectsAsTAM: { none: { id } } } },
      orderBy: { user: { username: "asc" } },
      select: memberSelect,
    });
    // Tasks in this project assigned to each member — removing a member
    // unassigns them, so the dialog warns with this count first.
    const counts = await prisma.task.groupBy({
      by: ["assignedToId"],
      where: { projectId: id, assignedToId: { in: members.map((m) => m.userId) } },
      _count: { _all: true },
    });
    const countByUser = new Map(counts.map((c) => [c.assignedToId, c._count._all]));
    res.json(members.map((m) => toMemberDto(m, countByUser.get(m.userId) ?? 0)));
  },
);

projectMembersRouter.post(
  "/:id/members",
  requirePermission("project:write"),
  validate("params", projectParamsSchema),
  requireVisibleProject,
  validate("body", addMemberSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof projectParamsSchema>;
    const { userId } = req.body as z.infer<typeof addMemberSchema>;

    const project = await prisma.project.findUniqueOrThrow({
      where: { id },
      select: { tamId: true },
    });
    if (project.tamId === userId) {
      throw new HttpError(400, "is_tam", "The project's TAM already has full access");
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { active: true, username: true },
    });
    if (!user) throw new HttpError(404, "user_not_found", "User not found");
    // Already a member -> idempotent 200, even if the user was deactivated
    // since; only a NEW membership requires an active user.
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId } },
      select: memberSelect,
    });
    if (existing) {
      res.status(200).json(toMemberDto(existing, await countAssigned(id, userId)));
      return;
    }
    if (!user.active) throw new HttpError(400, "user_inactive", "User is inactive");

    // skipDuplicates (ON CONFLICT DO NOTHING) keeps concurrent adds of the
    // same person race-free: exactly one caller sees count 1 (201).
    const { count } = await prisma.$transaction(async (tx) => {
      const result = await tx.projectMember.createMany({
        data: [{ projectId: id, userId, addedById: req.user!.sub }],
        skipDuplicates: true,
      });
      if (result.count === 1) {
        await recordActivity(tx, {
          projectId: id,
          actorId: req.user!.sub,
          entityType: "member",
          entityId: userId,
          action: "added",
          entityLabel: user.username,
        });
      }
      return result;
    });
    const member = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: id, userId } },
      select: memberSelect,
    });
    res
      .status(count === 1 ? 201 : 200)
      .json(toMemberDto(member, await countAssigned(id, userId)));
  },
);

projectMembersRouter.delete(
  "/:id/members/:userId",
  requirePermission("project:write"),
  validate("params", memberParamsSchema),
  requireVisibleProject,
  async (req, res) => {
    const { id, userId } = req.params as unknown as z.infer<typeof memberParamsSchema>;
    // Removing a member also unassigns their tasks in this project (user
    // decision 2026-09-30), atomically, so nothing stays assigned to a person
    // who can no longer open the project. Only when a membership row was
    // actually removed: DELETE for a non-member (204, idempotent) — notably
    // the project's TAM, who is never a visible member row — must leave tasks
    // alone.
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.projectMember.deleteMany({
        where: { projectId: id, userId },
      });
      // Never unassign the project's current TAM: a stale member row can
      // outlive a TAM reassignment (it stays hidden from the list), and
      // removing it must not strip the TAM's own tasks.
      const project = await tx.project.findUniqueOrThrow({
        where: { id },
        select: { tamId: true },
      });
      let unassigned = 0;
      if (count > 0 && userId !== project.tamId) {
        // Several task rows at once: keep clear of a concurrent reorder's
        // row-by-row re-pack (lib/orderLock.ts).
        await lockProjectOrder(tx, "tasks", id);
        ({ count: unassigned } = await tx.task.updateMany({
          where: { projectId: id, assignedToId: userId },
          data: { assignedToId: null },
        }));
      }
      if (count > 0) {
        const removed = await tx.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });
        await recordActivity(tx, {
          projectId: id,
          actorId: req.user!.sub,
          entityType: "member",
          entityId: userId,
          action: "removed",
          entityLabel: removed?.username ?? null,
          changes: unassigned > 0 ? { unassignedTasks: unassigned } : null,
        });
      }
    });
    res.status(204).end();
  },
);
