import { Router } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requireAdmin } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { bustAuthConfigCache } from "../authConfig.js";
import { normalizeUsername, USERNAME_MAX } from "../lib/username.js";
import { recordActivity, shortLabel, type ActivityChanges } from "../lib/activity.js";
import { notifyForEvent } from "../lib/notifications.js";

export const adminRouter = Router();

// Strict admin gate for the entire tree. requireAuth populates req.user;
// requireAdmin is permission-based — it admits any user whose role grants the
// "*" wildcard permission, not a role-name === "ADMIN" check. See e3f1cbd.
adminRouter.use(requireAuth, requireAdmin);

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

// Phase 1 of the role-name teardown: visibility and the admin gate are now
// permission-based, so ADMIN/TAM/STAKEHOLDER are ordinary admin-managed
// roles (renamable/deletable, subject to the anti-lockout guard). Only
// PENDING is still protected: first-time Google sign-in still resolves it
// by name (Phase 2 replaces that with a configurable default role).
const PROTECTED_ROLES = new Set(["PENDING"]);

// Admin access is permission-based ("*" wildcard), not role-name based.
// This guard refuses any mutation that would leave zero active users whose
// role grants "*" — otherwise nobody could reach /admin to undo it. Call it
// inside the same $transaction as the mutation so a violation rolls back.
async function ensureAdminsRemain(tx: Prisma.TransactionClient): Promise<void> {
  const admins = await tx.user.count({
    where: { active: true, role: { permissions: { array_contains: "*" } } },
  });
  if (admins === 0) {
    throw new HttpError(
      409,
      "would_lock_out",
      "That change would remove the last full-access (*) admin. Grant another role full access first.",
    );
  }
}

// ---- Users ----------------------------------------------------------------

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { username: "asc" }],
    select: {
      id: true,
      username: true,
      email: true,
      active: true,
      createdAt: true,
      googleSub: true,
      avatarUrl: true,
      role: { select: { roleName: true } },
      _count: { select: { projectsAsTAM: true } },
    },
  });
  res.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      active: u.active,
      role: u.role.roleName,
      createdAt: u.createdAt,
      provider: u.googleSub ? "google" : "password",
      avatarUrl: u.avatarUrl,
      projectsAsTAM: u._count.projectsAsTAM,
    })),
  );
});

const createUserSchema = z.object({
  email: z.string().email(),
  // Length only here; the character rule and the case-insensitive clash
  // check run in the handler (lib/username.ts).
  username: z.string().min(1).max(USERNAME_MAX * 2),
  password: z.string().min(8).max(200),
  role: z.string().min(1).max(50),
});

adminRouter.post(
  "/users",
  validate("body", createUserSchema),
  async (req, res) => {
    const { email, username: rawUsername, password, role } = req.body as z.infer<
      typeof createUserSchema
    >;

    const username = normalizeUsername(rawUsername);
    if (username === null) {
      throw new HttpError(
        400,
        "username_invalid",
        `Username must be 1-${USERNAME_MAX} characters: Latin letters, digits, spaces, and . _ ' - only`,
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "email_in_use", "A user with that email already exists");
    }
    // Case-insensitive on purpose: "Admin" beside "admin" is the same
    // look-alike problem as a homoglyph. Raw `lower() = lower()` rather than
    // Prisma's `mode: "insensitive"`, which compiles to ILIKE and would read
    // the allowed `_` as a one-character wildcard.
    const usernameClash = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM users WHERE lower(username) = lower(${username}) LIMIT 1
    `;
    if (usernameClash.length > 0) {
      throw new HttpError(409, "username_in_use", "A user with that username already exists");
    }

    const targetRole = await prisma.role.findUnique({
      where: { roleName: role },
    });
    if (!targetRole) {
      throw new HttpError(400, "role_not_found", `Role "${role}" does not exist`);
    }
    const passwordHash = await bcrypt.hash(password, 10);

    const created = await prisma.user.create({
      data: { email, username, passwordHash, roleId: targetRole.id },
      select: {
        id: true,
        username: true,
        email: true,
        active: true,
        createdAt: true,
        role: { select: { roleName: true } },
      },
    });

    res.status(201).json({
      id: created.id,
      username: created.username,
      email: created.email,
      active: created.active,
      role: created.role.roleName,
      createdAt: created.createdAt,
      provider: "password",
      avatarUrl: null,
      projectsAsTAM: 0,
    });
  },
);

const updateRoleSchema = z.object({ role: z.string().min(1).max(50) });

adminRouter.patch(
  "/users/:id/role",
  validate("params", idParamSchema),
  validate("body", updateRoleSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { role } = req.body as z.infer<typeof updateRoleSchema>;

    if (req.user!.sub === id) {
      throw new HttpError(400, "self_demote", "Admins cannot change their own role");
    }
    if (role === "PENDING") {
      throw new HttpError(
        400,
        "pending_assign_blocked",
        "PENDING is provisioning-only. Use deactivate to revoke access while keeping the row.",
      );
    }
    const target = await prisma.role.findUnique({ where: { roleName: role } });
    if (!target) {
      throw new HttpError(400, "role_not_found", `Role "${role}" does not exist`);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { roleId: target.id },
        select: {
          id: true,
          username: true,
          email: true,
          active: true,
          role: { select: { roleName: true } },
        },
      });
      await ensureAdminsRemain(tx);
      return u;
    });
    res.json({
      id: updated.id,
      username: updated.username,
      email: updated.email,
      active: updated.active,
      role: updated.role.roleName,
    });
  },
);

const deactivateSchema = z.object({ active: z.boolean() });

adminRouter.patch(
  "/users/:id/deactivate",
  validate("params", idParamSchema),
  validate("body", deactivateSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { active } = req.body as z.infer<typeof deactivateSchema>;

    if (req.user!.sub === id && active === false) {
      throw new HttpError(400, "self_deactivate", "Admins cannot deactivate themselves");
    }
    // Deactivating also bumps tokenVersion: the account's sessions end for
    // good, so a later reactivation does not resurrect tokens issued before.
    const updated = await prisma.user.update({
      where: { id },
      data: active ? { active } : { active, tokenVersion: { increment: 1 } },
      select: { id: true, username: true, email: true, active: true },
    });
    res.json(updated);
  },
);

adminRouter.delete(
  "/users/:id",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;

    if (req.user!.sub === id) {
      throw new HttpError(400, "self_delete", "Admins cannot delete themselves");
    }

    const target = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            projectsAsTAM: true,
            projectBaselinesLocked: true,
            assignedTasks: true,
            comments: true,
            // CustomerNote.author and WeeklyUpdate.author are RESTRICT FKs,
            // same as ProjectNote.author (projectNotes) — without these,
            // deleting an author 500s on a raw P2003 instead of the
            // friendly 400 below.
            projectNotes: true,
            customerNotes: true,
            weeklyUpdates: true,
          },
        },
      },
    });
    if (!target) throw new HttpError(404, "user_not_found", "User not found");

    const blockers: string[] = [];
    if (target._count.projectsAsTAM > 0)
      blockers.push(`${target._count.projectsAsTAM} project(s) as TAM`);
    if (target._count.projectBaselinesLocked > 0)
      blockers.push(`${target._count.projectBaselinesLocked} locked baseline(s)`);
    if (target._count.assignedTasks > 0)
      blockers.push(`${target._count.assignedTasks} assigned task(s)`);
    if (target._count.comments > 0)
      blockers.push(`${target._count.comments} comment(s)`);
    if (target._count.projectNotes > 0)
      blockers.push(`${target._count.projectNotes} daily note(s)`);
    if (target._count.customerNotes > 0)
      blockers.push(`${target._count.customerNotes} customer note(s)`);
    if (target._count.weeklyUpdates > 0)
      blockers.push(`${target._count.weeklyUpdates} weekly update(s)`);

    if (blockers.length > 0) {
      throw new HttpError(
        400,
        "user_in_use",
        `Cannot delete ${target.username}: still has ${blockers.join(", ")}. Reassign or remove these first.`,
      );
    }

    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  },
);

adminRouter.post(
  "/users/:id/reset-password",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    // An admin resetting their own password would end their own session with
    // a temp password nobody can relay — they use Settings instead.
    if (req.user!.sub === id) {
      throw new HttpError(
        400,
        "self_reset",
        "Use Settings > Change password for your own account",
      );
    }
    // 12-char URL-safe temp password. Returned ONCE in the response so the
    // admin can relay it to the user out-of-band (no mail infra in dev).
    const tempPassword = randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    // tokenVersion bump: the reset also ends the account's live sessions —
    // whoever held the old password holds no session.
    await prisma.user.update({
      where: { id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    res.json({ tempPassword });
  },
);

// ---- Roles -----------------------------------------------------------------

adminRouter.get("/roles", async (_req, res) => {
  const roles = await prisma.role.findMany({
    orderBy: { roleName: "asc" },
    select: {
      id: true,
      roleName: true,
      permissions: true,
      _count: { select: { users: true } },
    },
  });
  res.json(
    roles.map((r) => ({
      id: r.id,
      roleName: r.roleName,
      permissions: r.permissions,
      userCount: r._count.users,
      builtIn: PROTECTED_ROLES.has(r.roleName),
    })),
  );
});

const createRoleSchema = z.object({
  roleName: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Role name must be uppercase letters, digits, or underscores"),
  permissions: z.array(z.string().min(1).max(100)).max(50).default([]),
});

adminRouter.post(
  "/roles",
  validate("body", createRoleSchema),
  async (req, res) => {
    const { roleName, permissions } = req.body as z.infer<typeof createRoleSchema>;

    if (PROTECTED_ROLES.has(roleName)) {
      throw new HttpError(
        409,
        "role_reserved",
        `"${roleName}" is a reserved role name`,
      );
    }
    const existing = await prisma.role.findUnique({ where: { roleName } });
    if (existing) {
      throw new HttpError(409, "role_exists", `Role "${roleName}" already exists`);
    }

    const created = await prisma.role.create({
      data: { roleName, permissions },
      select: {
        id: true,
        roleName: true,
        permissions: true,
      },
    });
    res
      .status(201)
      .json({ ...created, userCount: 0, builtIn: false });
  },
);

const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1).max(100)).max(50),
  // Optional rename. Same constraints as create; protected roles (PENDING)
  // can't be renamed and a reserved name can't be taken.
  roleName: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Role name must be uppercase letters, digits, or underscores")
    .optional(),
});

adminRouter.patch(
  "/roles/:id",
  validate("params", idParamSchema),
  validate("body", updateRolePermissionsSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { permissions, roleName } = req.body as z.infer<
      typeof updateRolePermissionsSchema
    >;

    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "role_not_found", "Role not found");

    // PENDING is what every first-time Google sign-in gets: it must stay
    // without permissions until an admin promotes the user. (The seed used to
    // reset it at each start; since it no longer overwrites roles, this is
    // where that rule lives.)
    if (PROTECTED_ROLES.has(existing.roleName) && permissions.length > 0) {
      throw new HttpError(
        400,
        "role_protected",
        `"${existing.roleName}" is reserved and keeps no permissions`,
      );
    }

    const renaming = roleName !== undefined && roleName !== existing.roleName;
    if (renaming) {
      if (PROTECTED_ROLES.has(existing.roleName)) {
        throw new HttpError(
          400,
          "role_protected",
          `"${existing.roleName}" is reserved and cannot be renamed`,
        );
      }
      if (PROTECTED_ROLES.has(roleName!)) {
        throw new HttpError(400, "role_protected", `"${roleName}" is a reserved name`);
      }
      const clash = await prisma.role.findUnique({ where: { roleName: roleName! } });
      if (clash) {
        throw new HttpError(409, "role_exists", `Role "${roleName}" already exists`);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.role.update({
        where: { id },
        data: { permissions, ...(renaming ? { roleName: roleName! } : {}) },
        select: {
          id: true,
          roleName: true,
          permissions: true,
          _count: { select: { users: true } },
        },
      });
      await ensureAdminsRemain(tx);
      return u;
    });
    res.json({
      id: updated.id,
      roleName: updated.roleName,
      permissions: updated.permissions,
      userCount: updated._count.users,
      builtIn: PROTECTED_ROLES.has(updated.roleName),
    });
  },
);

adminRouter.delete(
  "/roles/:id",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const role = await prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new HttpError(404, "role_not_found", "Role not found");
    if (PROTECTED_ROLES.has(role.roleName)) {
      throw new HttpError(
        400,
        "role_protected",
        `"${role.roleName}" is reserved and cannot be deleted`,
      );
    }
    if (role._count.users > 0) {
      throw new HttpError(
        400,
        "role_in_use",
        `Role "${role.roleName}" still has ${role._count.users} user(s); reassign them first`,
      );
    }
    await prisma.role.delete({ where: { id } });
    res.status(204).end();
  },
);

// ---- Auth settings (OAuth policy singleton) -------------------------------

// Hostname regex: lowercase labels separated by dots, TLD ≥ 2 letters.
// Tight on purpose — we're an allowlist for *email domains*, not URLs.
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

// Google OAuth Client ID format: <digits>-<alnum>.apps.googleusercontent.com.
// Loose enough to accept any valid Google-issued ID without false rejects.
const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

adminRouter.get("/settings/auth", async (_req, res) => {
  const row = await prisma.authConfig.findUniqueOrThrow({
    where: { id: "default" },
    include: { updatedBy: { select: { id: true, username: true } } },
  });
  res.json({
    googleClientId: row.googleClientId,
    googleAllowedDomains: row.googleAllowedDomains,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  });
});

// All fields are optional in the body — admin can update Client ID alone,
// the domain list alone, or both together. Send `null` (or empty string,
// which transforms to null) to clear the Client ID.
const updateAuthSettingsSchema = z.object({
  googleClientId: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined; // not provided in body
      if (v === null) return null;
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    })
    .refine(
      (v) => v === undefined || v === null || GOOGLE_CLIENT_ID_PATTERN.test(v),
      {
        message:
          "Client ID must look like 123456789-abc.apps.googleusercontent.com",
      },
    ),
  googleAllowedDomains: z
    .array(
      z
        .string()
        .min(1)
        .max(253)
        .transform((s) => s.trim().toLowerCase())
        .refine((s) => DOMAIN_PATTERN.test(s), {
          message: "Each entry must be a valid hostname (e.g. example.com)",
        }),
    )
    .max(32, "At most 32 domains")
    .transform((arr) => Array.from(new Set(arr)))
    .optional(),
});

adminRouter.patch(
  "/settings/auth",
  validate("body", updateAuthSettingsSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof updateAuthSettingsSchema>;
    // Only touch columns the client actually sent — `undefined` means "leave
    // the existing value alone"; an explicit null on googleClientId clears it.
    const data: Prisma.AuthConfigUncheckedUpdateInput = {
      updatedById: req.user!.sub,
    };
    if (body.googleClientId !== undefined) data.googleClientId = body.googleClientId;
    if (body.googleAllowedDomains !== undefined)
      data.googleAllowedDomains = body.googleAllowedDomains;

    const row = await prisma.authConfig.update({
      where: { id: "default" },
      data,
      include: { updatedBy: { select: { id: true, username: true } } },
    });
    // Make the new value (and the cached OAuth2Client) take effect immediately
    // instead of waiting for the in-process 30s cache TTL.
    bustAuthConfigCache();
    res.json({
      googleClientId: row.googleClientId,
      googleAllowedDomains: row.googleAllowedDomains,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    });
  },
);

// ---- Projects (admin scope: all projects, all TAMs) -----------------------

adminRouter.get("/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      tam: { select: { id: true, username: true } },
      customer: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
  });
  res.json(projects);
});

const reassignSchema = z.object({
  projectId: z.number().int().positive(),
  newTamId: z.number().int().positive(),
});

adminRouter.put(
  "/projects/reassign",
  validate("body", reassignSchema),
  async (req, res) => {
    const { projectId, newTamId } = req.body as z.infer<typeof reassignSchema>;

    const tam = await prisma.user.findUnique({
      where: { id: newTamId },
      include: { role: true },
    });
    if (!tam) throw new HttpError(404, "tam_not_found", "Target user not found");
    if (!tam.active) {
      throw new HttpError(400, "tam_inactive", "Target user is deactivated");
    }
    // No role-name requirement: any active user can be a project's TAM
    // (admin's choice). Role names no longer gate this.

    // Same record as PATCH /projects/:id when it changes the TAM: one `updated`
    // event with `changes.tam = { from, to }` (ids and usernames only), and the
    // new TAM is notified (never the acting admin). A re-assignment to the
    // current TAM changes nothing and records nothing.
    const updated = await prisma.$transaction(async (tx) => {
      // Lock first so a concurrent save serialises and the diff is against the
      // row this write actually replaces.
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR NO KEY UPDATE`;
      const before = await tx.project.findUnique({
        where: { id: projectId },
        select: { tam: { select: { id: true, username: true } } },
      });
      if (!before) throw new HttpError(404, "not_found", "Project not found");
      const result = await tx.project.update({
        where: { id: projectId },
        data: { tamId: newTamId },
        include: {
          tam: { select: { id: true, username: true } },
          customer: { select: { id: true, name: true } },
          _count: { select: { tasks: true } },
        },
      });
      const changes: ActivityChanges = {};
      if (before.tam.id !== result.tam.id) {
        changes.tam = { from: before.tam, to: result.tam } as Prisma.InputJsonObject;
      }
      const event = await recordActivity(tx, {
        projectId,
        actorId: req.user!.sub,
        entityType: "project",
        entityId: projectId,
        action: "updated",
        entityLabel: shortLabel(result.name),
        changes,
      });
      await notifyForEvent(tx, event);
      return result;
    });
    res.json(updated);
  },
);
