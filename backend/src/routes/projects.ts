import { Router } from "express";
import { z } from "zod";
import {
  NoteVisibility,
  Prisma,
  Priority,
  ProjectStatus,
  RiskCategory,
  RiskStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { outlineUrlSchema } from "../lib/outlineUrl.js";
import {
  ensureProjectOwnerAccess,
  ensureProjectVisible,
  isCustomerVisible,
  projectVisibilityFilter,
} from "../lib/visibility.js";
import {
  isValidDayString,
  utcMidnightOf,
  utcMidnightOfDayString,
} from "../lib/dateBoundary.js";
import {
  assertLabelsInProject,
  assertSectionInProject,
  assertValidParent,
  countSiblings,
  type SiblingKey,
} from "../lib/taskOrdering.js";
import { assertEpicNotOnSubtask, assertValidEpic } from "../lib/epics.js";
import { computeProjectHealth, computeSlipDays } from "../lib/projectHealth.js";
import { ensureAssigneeIsMember } from "../lib/projectMembers.js";
import {
  diffProjectChanges,
  recordActivity,
  type ActivityChanges,
  shortLabel,
  taskCreatedChanges,
} from "../lib/activity.js";
import { epicCreatedChanges } from "../lib/epicActivity.js";
import { notifyForEvent } from "../lib/notifications.js";

// Kanban WIP limits — one optional positive-int cap per top-level status
// column, or null/absent for "no limit". Visual-only on the board (amber
// pill), never enforced server-side as a hard block.
const wipLimitsSchema = z
  .object({
    TODO: z.number().int().positive().nullable().optional(),
    IN_PROGRESS: z.number().int().positive().nullable().optional(),
    DONE: z.number().int().positive().nullable().optional(),
  })
  .nullable();

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  outlineUrl: outlineUrlSchema.optional(),
  tamId: z.number().int().positive().optional(),
  customerId: z.number().int().positive(),
  status: z.nativeEnum(ProjectStatus).optional(),
  wipLimits: wipLimitsSchema.optional(),
  excludeFromPortfolio: z.boolean().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  outlineUrl: outlineUrlSchema.optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  tamId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  wipLimits: wipLimitsSchema.optional(),
  excludeFromPortfolio: z.boolean().optional(),
});

// Caller's local calendar day ("yyyy-MM-dd") — the overdue boundary for the
// `health` block (lib/dateBoundary.ts). Optional; falls back to the UTC day.
const healthTodaySchema = z
  .string()
  .refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" })
  .optional();

const projectListQuerySchema = z.object({
  customerId: z.coerce.number().int().positive().optional(),
  today: healthTodaySchema,
});

const projectDetailQuerySchema = z.object({ today: healthTodaySchema });

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

// Shared "full project detail" include — used by GET /:id and both branches
// of POST /:id/baseline (previously duplicated three times). Keep list-view
// includes (GET /, /:id/tasks, etc.) separate — they're intentionally lighter.
const projectDetailInclude = {
  tam: { select: { id: true, username: true, email: true, avatarUrl: true } },
  customer: { select: { id: true, name: true, tamId: true } },
  baselineLockedBy: { select: { id: true, username: true } },
  _count: { select: { tasks: true } },
  services: {
    orderBy: { service: { name: "asc" } },
    include: { service: true },
  },
} satisfies Prisma.ProjectInclude;

const createTaskSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    status: z.nativeEnum(TaskStatus).optional(),
    priority: z.nativeEnum(Priority).optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    isMilestone: z.boolean().optional(),
    isCriticalPath: z.boolean().optional(),
    assignedToId: z.number().int().positive().nullable().optional(),
    parentTaskId: z.number().int().positive().nullable().optional(),
    sectionId: z.number().int().positive().nullable().optional(),
    labelIds: z.array(z.number().int().positive()).optional(),
    epicId: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => !b.isMilestone || b.dueDate != null, {
    message: "A milestone requires a due date",
    path: ["dueDate"],
  });

const createSectionSchema = z.object({
  name: z.string().min(1).max(100),
  position: z.number().int().min(0).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const createEpicSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

const taskListQuerySchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  parentTaskId: z
    .union([z.literal("null"), z.coerce.number().int().positive()])
    .optional(),
});

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

projectsRouter.get("/", validate("query", projectListQuerySchema), async (req, res) => {
  const { customerId, today } = req.query as unknown as z.infer<
    typeof projectListQuerySchema
  >;
  const where: Prisma.ProjectWhereInput = projectVisibilityFilter(req.user!);
  if (customerId) where.customerId = customerId;
  const projects = await prisma.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { tasks: true } },
      tam: { select: { id: true, username: true } },
      customer: { select: { id: true, name: true } },
    },
  });
  // Health for exactly the projects the visibility filter returned — one
  // fixed-cost batch (lib/projectHealth.ts), not a query per project.
  const health = await computeProjectHealth(
    projects.map((p) => p.id),
    today,
  );
  res.json(projects.map((p) => ({ ...p, health: health.get(p.id) })));
});

projectsRouter.post(
  "/",
  requirePermission("project:write"),
  validate("body", createProjectSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createProjectSchema>;
    const tamId = body.tamId ?? req.user!.sub;
    if (!(await isCustomerVisible(req.user!, body.customerId))) {
      throw new HttpError(400, "customer_not_found", "Customer not found");
    }

    // The project and its `created` event commit together. The event snapshots
    // who holds the TAM seat and the customer — ids and display names only,
    // never emails (docs/archive/plans/internal-sync.md).
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name: body.name,
          description: body.description,
          outlineUrl: body.outlineUrl ?? null,
          tamId,
          customerId: body.customerId,
          status: body.status ?? "PLANNING",
          wipLimits: body.wipLimits ?? undefined,
          excludeFromPortfolio: body.excludeFromPortfolio ?? false,
        },
      });
      const [tam, customer] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: created.tamId }, select: { id: true, username: true } }),
        created.customerId === null
          ? null
          : tx.customer.findUnique({ where: { id: created.customerId }, select: { id: true, name: true } }),
      ]);
      const event = await recordActivity(tx, {
        projectId: created.id,
        actorId: req.user!.sub,
        entityType: "project",
        entityId: created.id,
        action: "created",
        entityLabel: shortLabel(created.name),
        changes: { tam, customer } as Prisma.InputJsonObject as ActivityChanges,
      });
      // The named TAM gets an `assigned` notification (never the actor).
      await notifyForEvent(tx, event);
      return created;
    });
    res.status(201).json(project);
  },
);

projectsRouter.get("/:id", validate("params", idParamSchema), validate("query", projectDetailQuerySchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const { today } = req.query as unknown as z.infer<typeof projectDetailQuerySchema>;
  // Apply the visibility filter inside the lookup. The previous hand-rolled
  // `"tamId" in filter` guard was a dead no-op — the filter's only top-level
  // key is `OR` (tamId / customer-owner / member arms), so that key never
  // exists — which left this
  // endpoint open to IDOR. Returning 404 (not 403) also stops leaking
  // existence, matching every other project-scoped route.
  const project = await prisma.project.findFirst({
    where: { id, ...projectVisibilityFilter(req.user!) },
    include: projectDetailInclude,
  });
  if (!project) throw new HttpError(404, "not_found", "Project not found");

  // slipDays needs the project's own due/baseline dates; computeSlipDays
  // returns null without a baseline lock, so skip the read in that case.
  const [healthByProject, slipTasks] = await Promise.all([
    computeProjectHealth([id], today),
    project.baselineLockedAt
      ? prisma.task.findMany({
          where: { projectId: id },
          select: { dueDate: true, baselineDueDate: true },
        })
      : Promise.resolve([]),
  ]);
  res.json({
    ...project,
    health: {
      ...healthByProject.get(id)!,
      slipDays: computeSlipDays(project.baselineLockedAt, slipTasks),
    },
  });
});

const lockBaselineSchema = z.object({
  asOfDate: z.coerce.date().optional(),
  clear: z.boolean().optional(),
});

projectsRouter.post(
  "/:id/baseline",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", lockBaselineSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { asOfDate, clear } = req.body as z.infer<typeof lockBaselineSchema>;
    await ensureProjectVisible(req.user!, id);
    const lockedAt = asOfDate ?? new Date();

    const updated = await prisma.$transaction(async (tx) => {
      if (clear) {
        await tx.$executeRaw`
          UPDATE tasks
          SET baseline_start_date = NULL,
              baseline_due_date = NULL
          WHERE project_id = ${id}
        `;
        return tx.project.update({
          where: { id },
          data: { baselineLockedAt: null, baselineLockedById: null },
          include: projectDetailInclude,
        });
      }
      // Column-to-column copy: live → baseline for every task in the project.
      // Prisma's updateMany can't reference other columns, so raw SQL.
      await tx.$executeRaw`
        UPDATE tasks
        SET baseline_start_date = start_date,
            baseline_due_date = due_date
        WHERE project_id = ${id}
      `;
      return tx.project.update({
        where: { id },
        data: {
          baselineLockedAt: lockedAt,
          baselineLockedById: req.user!.sub,
        },
        include: projectDetailInclude,
      });
    });
    res.json(updated);
  },
);

// Project-scoped service catalogue assignment — mirrors the customer-side
// mapping in routes/customers.ts (same replace-whole-set transaction shape).
const assignServicesSchema = z.object({
  assignments: z.array(
    z.object({
      serviceId: z.number().int().positive(),
      tools: z.array(z.string().trim().min(1).max(100)).default([]),
    }),
  ),
});

projectsRouter.put(
  "/:id/services",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", assignServicesSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { assignments } = req.body as z.infer<typeof assignServicesSchema>;
    await ensureProjectVisible(req.user!, id);

    // Replace the whole assignment set in a single transaction:
    // - delete rows whose serviceId is no longer in the list
    // - upsert each desired (serviceId, tools)
    const desiredIds = assignments.map((a) => a.serviceId);
    const uniqueIds = [...new Set(desiredIds)];
    if (uniqueIds.length > 0) {
      const found = await prisma.service.count({ where: { id: { in: uniqueIds } } });
      if (found !== uniqueIds.length) {
        throw new HttpError(400, "service_not_found", "One or more services do not exist");
      }
    }
    await prisma.$transaction([
      prisma.projectService.deleteMany({
        where: {
          projectId: id,
          ...(desiredIds.length > 0 && { serviceId: { notIn: desiredIds } }),
        },
      }),
      ...assignments.map((a) =>
        prisma.projectService.upsert({
          where: {
            projectId_serviceId: { projectId: id, serviceId: a.serviceId },
          },
          create: { projectId: id, serviceId: a.serviceId, tools: a.tools },
          update: { tools: a.tools },
        }),
      ),
    ]);

    const updated = await prisma.project.findUniqueOrThrow({
      where: { id },
      include: projectDetailInclude,
    });
    res.json(updated);
  },
);

projectsRouter.patch(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", updateProjectSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateProjectSchema>;
    await ensureProjectVisible(req.user!, id);

    // Re-parenting a project (TAM or customer) is owner-only; a member may
    // still edit everything else. Re-saving the current values is not a change.
    if (body.tamId !== undefined || body.customerId !== undefined) {
      const current = await prisma.project.findUniqueOrThrow({
        where: { id },
        select: { tamId: true, customerId: true },
      });
      if (
        (body.tamId !== undefined && body.tamId !== current.tamId) ||
        (body.customerId !== undefined && body.customerId !== current.customerId)
      ) {
        await ensureProjectOwnerAccess(req.user!, id);
      }
    }

    const data: Prisma.ProjectUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.outlineUrl !== undefined) data.outlineUrl = body.outlineUrl;
    if (body.status !== undefined) data.status = body.status;
    if (body.tamId !== undefined) data.tam = { connect: { id: body.tamId } };
    if (body.customerId !== undefined) {
      if (!(await isCustomerVisible(req.user!, body.customerId))) {
        throw new HttpError(400, "customer_not_found", "Customer not found");
      }
      data.customer = { connect: { id: body.customerId } };
    }
    if (body.wipLimits !== undefined) {
      data.wipLimits = body.wipLimits === null ? Prisma.JsonNull : body.wipLimits;
    }
    if (body.excludeFromPortfolio !== undefined) {
      data.excludeFromPortfolio = body.excludeFromPortfolio;
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Lock first so a concurrent save serialises and the diff is against the
      // row this write actually replaced.
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${id} FOR NO KEY UPDATE`;
      const before = await tx.project.findUniqueOrThrow({
        where: { id },
        select: {
          name: true,
          status: true,
          customerId: true,
          tam: { select: { id: true, username: true } },
        },
      });
      const result = await tx.project.update({ where: { id }, data });
      // Name, status, customer and the TAM seat are logged (ids and usernames
      // only); a re-save records nothing.
      const changes: ActivityChanges = diffProjectChanges(
        { name: before.name, status: before.status, customerId: before.customerId },
        result,
      );
      if (before.tam.id !== result.tamId) {
        const to = await tx.user.findUnique({ where: { id: result.tamId }, select: { id: true, username: true } });
        changes.tam = { from: before.tam, to } as Prisma.InputJsonObject;
      }
      const event = await recordActivity(tx, {
        projectId: id,
        actorId: req.user!.sub,
        entityType: "project",
        entityId: id,
        action: "updated",
        entityLabel: shortLabel(result.name),
        changes,
      });
      // The new TAM (changes.tam `to`) gets an `assigned` notification; the
      // actor and inactive users are skipped inside.
      await notifyForEvent(tx, event);
      return result;
    });
    res.json(updated);
  },
);

projectsRouter.delete(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectOwnerAccess(req.user!, id);

    // Hard delete, no soft-delete or undo — the UI confirms first. The schema
    // cascades to the project's tasks (with their subtasks, comments and
    // dependencies), sections, labels, risks, notes, reviews and service
    // assignments.
    await prisma.project.delete({ where: { id } });
    res.status(204).end();
  },
);

projectsRouter.get(
  "/:id/tasks",
  validate("params", idParamSchema),
  validate("query", taskListQuerySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { status, parentTaskId } = req.query as unknown as z.infer<typeof taskListQuerySchema>;
    await ensureProjectVisible(req.user!, id);

    const where: Prisma.TaskWhereInput = { projectId: id };
    if (status) where.status = status;
    if (parentTaskId === "null") where.parentTaskId = null;
    else if (typeof parentTaskId === "number") where.parentTaskId = parentTaskId;

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: {
        assignedTo: { select: { id: true, username: true, email: true } },
        labels: true,
        section: { select: { id: true, name: true, position: true, color: true } },
        _count: { select: { subtasks: true, comments: true } },
      },
    });
    res.json(tasks);
  },
);

projectsRouter.post(
  "/:id/tasks",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createTaskSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof createTaskSchema>;
    await ensureProjectVisible(req.user!, id);

    const status = body.status ?? "TODO";

    const task = await prisma.$transaction(async (tx) => {
      if (body.parentTaskId) {
        // assertValidParent needs a real taskId to compare against for the
        // self-parent / subtask-depth checks; a not-yet-created task can't
        // collide with those, so pass 0 (never a valid id) as a sentinel.
        await assertValidParent(tx, id, 0, body.parentTaskId);
      }
      if (body.sectionId != null) {
        await assertSectionInProject(tx, id, body.sectionId);
      }
      if (body.labelIds && body.labelIds.length > 0) {
        await assertLabelsInProject(tx, id, body.labelIds);
      }
      if (body.epicId != null) {
        assertEpicNotOnSubtask(body.epicId, body.parentTaskId ?? null);
        await assertValidEpic(tx, id, body.epicId);
      }

      // Assigning someone who cannot see the project adds them as a member
      // (same transaction as the task write).
      if (body.assignedToId != null) {
        const added = await ensureAssigneeIsMember(tx, id, body.assignedToId, req.user!.sub);
        if (added) {
          await recordActivity(tx, {
            projectId: id,
            actorId: req.user!.sub,
            entityType: "member",
            entityId: body.assignedToId,
            action: "added",
            entityLabel: added.username,
          });
        }
      }

      const siblingKey: SiblingKey = {
        projectId: id,
        parentTaskId: body.parentTaskId ?? null,
      };
      const position = await countSiblings(tx, siblingKey);

      const created = await tx.task.create({
        data: {
          projectId: id,
          title: body.title,
          description: body.description,
          status,
          priority: body.priority ?? "MEDIUM",
          // Milestones anchor to their due date; keep startDate in lockstep
          // so geometry and exports see a single-day marker.
          startDate:
            body.isMilestone && body.dueDate
              ? body.dueDate
              : body.startDate ?? null,
          dueDate: body.dueDate ?? null,
          isMilestone: body.isMilestone ?? false,
          isCriticalPath: body.isCriticalPath ?? false,
          assignedToId: body.assignedToId ?? null,
          parentTaskId: body.parentTaskId ?? null,
          sectionId: body.sectionId ?? null,
          epicId: body.epicId ?? null,
          position,
          labels: body.labelIds && body.labelIds.length > 0
            ? { connect: body.labelIds.map((lid) => ({ id: lid })) }
            : undefined,
        },
        include: {
          assignedTo: { select: { id: true, username: true, email: true } },
          labels: true,
          section: { select: { id: true, name: true, position: true, color: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
      });
      const event = await recordActivity(tx, {
        projectId: id,
        actorId: req.user!.sub,
        entityType: "task",
        entityId: created.id,
        action: "created",
        entityLabel: created.title,
        changes: taskCreatedChanges(created),
      });
      await notifyForEvent(tx, event);
      return created;
    });
    res.status(201).json(task);
  },
);

projectsRouter.get(
  "/:id/sections",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);
    const sections = await prisma.section.findMany({
      where: { projectId: id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    res.json(sections);
  },
);

projectsRouter.post(
  "/:id/sections",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createSectionSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof createSectionSchema>;
    await ensureProjectVisible(req.user!, id);
    const max = await prisma.section.aggregate({
      where: { projectId: id },
      _max: { position: true },
    });
    const section = await prisma.section.create({
      data: {
        projectId: id,
        name: body.name,
        position: body.position ?? (max._max.position ?? -1) + 1,
        ...(body.color !== undefined && { color: body.color }),
      },
    });
    res.status(201).json(section);
  },
);

// Project-scoped epics — see docs/archive/plans/epics-spec.md §4-5. Item-scoped
// PATCH/DELETE/GET-detail live in routes/epics.ts; collection routes stay
// here for URL nesting, mirroring sections.
projectsRouter.get(
  "/:id/epics",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);

    const epics = await prisma.epic.findMany({
      where: { projectId: id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: { owner: { select: { id: true, username: true, email: true } } },
    });

    // One groupBy over top-level tasks carrying an epicId in this project —
    // never N+1 (acceptance criterion in docs/archive/plans/epics-spec.md §7 T1).
    // Subtasks are excluded: progress counts stories, not their subtasks.
    const counts = await prisma.task.groupBy({
      by: ["epicId", "status"],
      where: { projectId: id, epicId: { not: null }, parentTaskId: null },
      _count: { _all: true },
    });
    const progressByEpic = new Map<number, { done: number; total: number }>();
    for (const row of counts) {
      const epicId = row.epicId!;
      const entry = progressByEpic.get(epicId) ?? { done: 0, total: 0 };
      entry.total += row._count._all;
      if (row.status === "DONE") entry.done += row._count._all;
      progressByEpic.set(epicId, entry);
    }

    res.json(
      epics.map((epic) => ({
        ...epic,
        progress: progressByEpic.get(epic.id) ?? { done: 0, total: 0 },
      })),
    );
  },
);

projectsRouter.post(
  "/:id/epics",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createEpicSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof createEpicSchema>;
    await ensureProjectVisible(req.user!, id);

    // Appends at the end. Epics have no re-pack on delete (unlike tasks'
    // countSiblings, which is safe because DELETE /tasks/:id never re-packs
    // either, but nothing here re-packs the epic list after a delete), so a
    // plain count would collide with — or land before — an existing epic
    // once any earlier epic has been deleted (count != max position + 1).
    // max(position) + 1 mirrors the sections POST /:id/sections above.
    const max = await prisma.epic.aggregate({
      where: { projectId: id },
      _max: { position: true },
    });
    const position = (max._max.position ?? -1) + 1;
    const epic = await prisma.$transaction(async (tx) => {
      const created = await tx.epic.create({
        data: {
          projectId: id,
          title: body.title,
          description: body.description ?? null,
          ownerId: body.ownerId ?? null,
          startDate: body.startDate ?? null,
          dueDate: body.dueDate ?? null,
          position,
          ...(body.color !== undefined && { color: body.color }),
        },
        include: { owner: { select: { id: true, username: true, email: true } } },
      });
      await recordActivity(tx, {
        projectId: id,
        actorId: req.user!.sub,
        entityType: "epic",
        entityId: created.id,
        action: "created",
        entityLabel: shortLabel(created.title),
        changes: epicCreatedChanges(created),
      });
      return created;
    });
    res.status(201).json({ ...epic, progress: { done: 0, total: 0 } });
  },
);

// Project-scoped risks
const createRiskSchema = z.object({
  description: z.string().min(1).max(2000),
  category: z.nativeEnum(RiskCategory).optional(),
  probability: z.number().int().min(1).max(5).optional(),
  impact: z.number().int().min(1).max(5).optional(),
  status: z.nativeEnum(RiskStatus).optional(),
  mitigationPlan: z.string().max(4000).nullable().optional(),
  contingencyPlan: z.string().max(4000).nullable().optional(),
});

projectsRouter.get(
  "/:id/risks",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);

    const risks = await prisma.risk.findMany({
      where: { projectId: id },
      orderBy: [{ status: "asc" }, { id: "desc" }],
    });
    res.json(risks);
  },
);

projectsRouter.post(
  "/:id/risks",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createRiskSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);

    const body = req.body as z.infer<typeof createRiskSchema>;
    const risk = await prisma.$transaction(async (tx) => {
      const created = await tx.risk.create({
        data: {
          projectId: id,
          description: body.description,
          category: body.category ?? "INTERNAL",
          probability: body.probability ?? 1,
          impact: body.impact ?? 1,
          status: body.status ?? "OPEN",
          mitigationPlan: body.mitigationPlan ?? null,
          contingencyPlan: body.contingencyPlan ?? null,
        },
      });
      await recordActivity(tx, {
        projectId: id,
        actorId: req.user!.sub,
        entityType: "risk",
        entityId: created.id,
        action: "created",
        entityLabel: shortLabel(created.description),
      });
      return created;
    });
    res.status(201).json(risk);
  },
);

// Project-scoped Daily Review notes.
// INTERNAL is the default visibility; CUSTOMER_FACING is opt-in per note
// and is the only visibility any customer-facing output may ever surface.
// Plain calendar day ("yyyy-MM-dd", no time/zone) — noteDate/reviewDate are
// `@db.Date` columns for exactly this reason. Same house day-string helper
// routes/tasks.ts uses (lib/dateBoundary.ts).
const dayStringSchema = z
  .string()
  .refine(isValidDayString, { message: "Must be a valid yyyy-MM-dd date" });

const noteListQuerySchema = z.object({
  visibility: z.nativeEnum(NoteVisibility).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  from: dayStringSchema.optional(),
  to: dayStringSchema.optional(),
});

const createNoteSchema = z.object({
  body: z.string().min(1).max(4000),
  visibility: z.nativeEnum(NoteVisibility).optional(),
  noteDate: dayStringSchema.optional(),
});

const updateNoteSchema = z.object({
  body: z.string().min(1).max(4000),
});

const noteIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  noteId: z.coerce.number().int().positive(),
});

projectsRouter.get(
  "/:id/notes",
  validate("params", idParamSchema),
  validate("query", noteListQuerySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { visibility, limit, from, to } = req.query as unknown as z.infer<
      typeof noteListQuerySchema
    >;
    await ensureProjectVisible(req.user!, id);

    const where: Prisma.ProjectNoteWhereInput = { projectId: id };
    if (visibility) where.visibility = visibility;
    if (from || to) {
      where.noteDate = {
        ...(from && { gte: utcMidnightOfDayString(from) }),
        ...(to && { lte: utcMidnightOfDayString(to) }),
      };
    }

    // An explicit `limit` always wins. Otherwise: a from/to window means the
    // caller asked for a bounded range on purpose (e.g. the 14-day Project
    // Overview block) — don't truncate it with the unwindowed default; only
    // apply the default 50 cap when there's no window to bound the result.
    const take = limit ?? (from || to ? undefined : 50);

    const notes = await prisma.projectNote.findMany({
      where,
      // noteDate desc keeps a from/to window view stable regardless of
      // when each note was actually written.
      orderBy: [{ noteDate: "desc" }, { id: "desc" }],
      take,
      include: { author: { select: { id: true, username: true } } },
    });
    res.json(notes);
  },
);

projectsRouter.post(
  "/:id/notes",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createNoteSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);

    const body = req.body as z.infer<typeof createNoteSchema>;
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.projectNote.create({
        data: {
          projectId: id,
          authorId: req.user!.sub,
          noteDate: body.noteDate
            ? utcMidnightOfDayString(body.noteDate)
            : utcMidnightOf(Date.now()),
          body: body.body,
          visibility: body.visibility ?? "INTERNAL",
        },
        include: { author: { select: { id: true, username: true } } },
      });
      // Note events carry the id and visibility only — never the body.
      await recordActivity(tx, {
        projectId: id,
        actorId: req.user!.sub,
        entityType: "note",
        entityId: created.id,
        action: "created",
        changes: { visibility: created.visibility },
      });
      return created;
    });
    res.status(201).json(note);
  },
);

projectsRouter.patch(
  "/:id/notes/:noteId",
  requirePermission("project:write"),
  validate("params", noteIdParamSchema),
  validate("body", updateNoteSchema),
  async (req, res) => {
    const { id, noteId } = req.params as unknown as z.infer<typeof noteIdParamSchema>;
    const body = req.body as z.infer<typeof updateNoteSchema>;
    await ensureProjectVisible(req.user!, id);

    const note = await prisma.projectNote.findFirst({
      where: { id: noteId, projectId: id },
    });
    if (!note) throw new HttpError(404, "note_not_found", "Note not found");
    if (note.authorId !== req.user!.sub) {
      throw new HttpError(403, "not_note_author", "Only the author may edit this note");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.projectNote.update({
        where: { id: noteId },
        data: { body: body.body },
        include: { author: { select: { id: true, username: true } } },
      });
      // A save that left the body unchanged is not an edit worth logging.
      if (body.body !== note.body) {
        await recordActivity(tx, {
          projectId: id,
          actorId: req.user!.sub,
          entityType: "note",
          entityId: noteId,
          action: "updated",
          changes: { visibility: result.visibility },
        });
      }
      return result;
    });
    res.json(updated);
  },
);

projectsRouter.delete(
  "/:id/notes/:noteId",
  requirePermission("project:write"),
  validate("params", noteIdParamSchema),
  async (req, res) => {
    const { id, noteId } = req.params as unknown as z.infer<typeof noteIdParamSchema>;
    await ensureProjectVisible(req.user!, id);

    const note = await prisma.projectNote.findFirst({
      where: { id: noteId, projectId: id },
    });
    if (!note) throw new HttpError(404, "note_not_found", "Note not found");
    if (note.authorId !== req.user!.sub && !hasPermission(req.user!, "*")) {
      throw new HttpError(
        403,
        "not_note_author",
        "Only the author or an admin may delete this note",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectNote.delete({ where: { id: noteId } });
      await recordActivity(tx, {
        projectId: id,
        actorId: req.user!.sub,
        entityType: "note",
        entityId: noteId,
        action: "deleted",
        changes: { visibility: note.visibility },
      });
    });
    res.status(204).send();
  },
);

// Project-scoped daily reviews — one row per (project, user, day), marking
// that the caller looked at the project that day. Upsert semantics: POSTing
// an already-reviewed day is a no-op that returns the existing row with 200
// instead of a duplicate-key error.
const createReviewSchema = z.object({
  reviewDate: dayStringSchema,
});

const reviewDateParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  reviewDate: dayStringSchema,
});

projectsRouter.post(
  "/:id/reviews",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createReviewSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { reviewDate } = req.body as z.infer<typeof createReviewSchema>;
    await ensureProjectVisible(req.user!, id);

    const reviewDateValue = utcMidnightOfDayString(reviewDate);
    const existing = await prisma.projectReview.findUnique({
      where: {
        projectId_userId_reviewDate: {
          projectId: id,
          userId: req.user!.sub,
          reviewDate: reviewDateValue,
        },
      },
    });
    if (existing) {
      res.status(200).json(existing);
      return;
    }

    const review = await prisma.projectReview.create({
      data: {
        projectId: id,
        userId: req.user!.sub,
        reviewDate: reviewDateValue,
      },
    });
    res.status(201).json(review);
  },
);

projectsRouter.delete(
  "/:id/reviews/:reviewDate",
  requirePermission("project:write"),
  validate("params", reviewDateParamSchema),
  async (req, res) => {
    const { id, reviewDate } = req.params as unknown as z.infer<
      typeof reviewDateParamSchema
    >;
    await ensureProjectVisible(req.user!, id);

    // Idempotent by design: the UI unmarks optimistically, so a double
    // click or a stale card re-sending the same delete must not surface an
    // error — 204 whether or not a row existed to remove.
    await prisma.projectReview.deleteMany({
      where: {
        projectId: id,
        userId: req.user!.sub,
        reviewDate: utcMidnightOfDayString(reviewDate),
      },
    });
    res.status(204).send();
  },
);

// Project-scoped task dependencies. The dependency rows themselves are
// item-scoped (PATCH/DELETE) in routes/dependencies.ts; collection routes
// stay here for URL nesting.
const createDependencySchema = z.object({
  predecessorTaskId: z.number().int().positive(),
  successorTaskId: z.number().int().positive(),
  type: z.enum(["HARD", "SOFT"]).optional(),
  // Routing hints from the diagram drag — preserve which side of each
  // node the connection enters/exits. Validated loosely: any string from
  // the client, since the handle ID set is owned by the React Flow code.
  sourceHandle: z.string().max(40).nullable().optional(),
  targetHandle: z.string().max(40).nullable().optional(),
});

projectsRouter.get(
  "/:id/dependencies",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);

    const deps = await prisma.taskDependency.findMany({
      where: { projectId: id },
      orderBy: { id: "asc" },
    });
    res.json(deps);
  },
);

projectsRouter.post(
  "/:id/dependencies",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  validate("body", createDependencySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);

    const body = req.body as z.infer<typeof createDependencySchema>;
    if (body.predecessorTaskId === body.successorTaskId) {
      throw new HttpError(400, "self_dependency", "A task cannot depend on itself.");
    }

    // Both endpoints must live on this project.
    const tasks = await prisma.task.findMany({
      where: { id: { in: [body.predecessorTaskId, body.successorTaskId] }, projectId: id },
      select: { id: true },
    });
    if (tasks.length !== 2) {
      throw new HttpError(400, "task_not_in_project", "Both tasks must belong to this project.");
    }

    // Reject cycles: walk forward from `successor` over existing edges; if we
    // reach `predecessor` the new edge would close a loop.
    const allEdges = await prisma.taskDependency.findMany({
      where: { projectId: id },
      select: { predecessorTaskId: true, successorTaskId: true },
    });
    const adj = new Map<number, number[]>();
    for (const e of allEdges) {
      const arr = adj.get(e.predecessorTaskId) ?? [];
      arr.push(e.successorTaskId);
      adj.set(e.predecessorTaskId, arr);
    }
    const seen = new Set<number>();
    const stack = [body.successorTaskId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === body.predecessorTaskId) {
        throw new HttpError(400, "cycle", "This dependency would create a cycle.");
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }

    try {
      const dep = await prisma.taskDependency.create({
        data: {
          projectId: id,
          predecessorTaskId: body.predecessorTaskId,
          successorTaskId: body.successorTaskId,
          type: body.type ?? "HARD",
          sourceHandle: body.sourceHandle ?? null,
          targetHandle: body.targetHandle ?? null,
        },
      });
      res.status(201).json(dep);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(409, "duplicate", "This dependency already exists.");
      }
      throw err;
    }
  },
);

// Project-scoped labels (kept on the projects router for the nested URL)
const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

projectsRouter.get(
  "/:id/labels",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureProjectVisible(req.user!, id);
    const labels = await prisma.label.findMany({
      where: { projectId: id },
      orderBy: { name: "asc" },
    });
    res.json(labels);
  },
);

projectsRouter.post(
  "/:id/labels",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createLabelSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof createLabelSchema>;
    await ensureProjectVisible(req.user!, id);
    const label = await prisma.label.create({
      data: {
        projectId: id,
        name: body.name,
        color: body.color ?? "#3aae51",
      },
    });
    res.status(201).json(label);
  },
);
