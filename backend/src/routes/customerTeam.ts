import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, hasPermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { customerVisibilityFilter } from "../lib/visibility.js";
import { unassignWhereAccessLost } from "../lib/projectMembers.js";

// Customer team (GitHub #93, docs/archive/plans/customer-team.md): users who
// work on a customer and get the access of a project member on every project
// linked to it (lib/visibility.ts, team arm) — never ownership. Mounted on
// /customers next to customersRouter (kept out of that file).
//
// Who manages the list: the customer's owner (`Customer.tamId`) holding
// `customer:write`, or any holder of `customer:team-all` (every customer,
// unowned ones included; "*" satisfies it). `project:view-all` does not.

const customerParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const memberParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});
const addMemberSchema = z.object({ userId: z.number().int().positive() });

const memberSelect = {
  userId: true,
  createdAt: true,
  user: { select: { username: true, email: true, active: true } },
  addedBy: { select: { id: true, username: true } },
} as const;

type MemberRow = {
  userId: number;
  createdAt: Date;
  user: { username: string; email: string; active: boolean };
  addedBy: { id: number; username: string } | null;
};

function toMemberDto(m: MemberRow) {
  return {
    userId: m.userId,
    username: m.user.username,
    email: m.user.email,
    active: m.user.active,
    addedAt: m.createdAt.toISOString(),
    addedBy: m.addedBy,
  };
}

function canManageTeam(user: JwtPayload, customer: { tamId: number | null }): boolean {
  return (
    hasPermission(user, "customer:team-all") ||
    (customer.tamId === user.sub && hasPermission(user, "customer:write"))
  );
}

// 404 for a customer the caller cannot see comes first (a hidden customer is
// indistinguishable from a missing one); the manage check follows.
async function loadCustomer(req: Request, requireManage: boolean) {
  const { id } = req.params as unknown as z.infer<typeof customerParamsSchema>;
  const customer = await prisma.customer.findFirst({
    where: { id, ...customerVisibilityFilter(req.user!) },
    select: { id: true, tamId: true },
  });
  if (!customer) throw new HttpError(404, "customer_not_found", "Customer not found");
  if (requireManage && !canManageTeam(req.user!, customer)) {
    throw new HttpError(403, "forbidden", "Only the customer's owner can manage its team");
  }
  return customer;
}

function gate(requireManage: boolean) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    await loadCustomer(req, requireManage);
    next();
  };
}

export const customerTeamRouter = Router();

customerTeamRouter.use(requireAuth);

customerTeamRouter.get(
  "/:id/team",
  requirePermission("customer:read"),
  validate("params", customerParamsSchema),
  async (req, res) => {
    const customer = await loadCustomer(req, false);
    const members = await prisma.customerTeamMember.findMany({
      where: { customerId: customer.id },
      orderBy: { user: { username: "asc" } },
      select: memberSelect,
    });
    res.json({ members: members.map(toMemberDto), canManage: canManageTeam(req.user!, customer) });
  },
);

customerTeamRouter.post(
  "/:id/team",
  requirePermission("customer:read"),
  validate("params", customerParamsSchema),
  gate(true),
  validate("body", addMemberSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof customerParamsSchema>;
    const { userId } = req.body as z.infer<typeof addMemberSchema>;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { active: true, username: true },
    });
    if (!user) throw new HttpError(404, "user_not_found", "User not found");
    if (!user.active) throw new HttpError(400, "user_inactive", "User is inactive");

    try {
      await prisma.$transaction(async (tx) => {
        await tx.customerTeamMember.create({
          data: { customerId: id, userId, addedById: req.user!.sub },
        });
        await tx.customerActivityEvent.create({
          data: {
            customerId: id,
            actorId: req.user!.sub,
            action: "team_member_added",
            memberId: userId,
            memberName: user.username,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new HttpError(409, "already_member", "User is already on the team");
      }
      throw e;
    }
    const member = await prisma.customerTeamMember.findUniqueOrThrow({
      where: { customerId_userId: { customerId: id, userId } },
      select: memberSelect,
    });
    res.status(201).json(toMemberDto(member));
  },
);

customerTeamRouter.delete(
  "/:id/team/:userId",
  requirePermission("customer:read"),
  validate("params", memberParamsSchema),
  gate(true),
  async (req, res) => {
    const { id, userId } = req.params as unknown as z.infer<typeof memberParamsSchema>;
    await prisma.$transaction(async (tx) => {
      const member = await tx.customerTeamMember.findUnique({
        where: { customerId_userId: { customerId: id, userId } },
        select: { user: { select: { username: true } } },
      });
      if (!member) throw new HttpError(404, "not_a_member", "User is not on the team");
      await tx.customerTeamMember.delete({
        where: { customerId_userId: { customerId: id, userId } },
      });
      await tx.customerActivityEvent.create({
        data: {
          customerId: id,
          actorId: req.user!.sub,
          action: "team_member_removed",
          memberId: userId,
          memberName: member.user.username,
        },
      });
      // Access ended: tasks they hold in projects they can no longer see go
      // back to unassigned (same rule as removing a project member).
      const linked = await tx.projectCustomer.findMany({
        where: { customerId: id },
        select: { projectId: true },
      });
      await unassignWhereAccessLost(tx, {
        userIds: [userId],
        projectIds: linked.map((l) => l.projectId),
        actorId: req.user!.sub,
      });
    });
    res.status(204).end();
  },
);
