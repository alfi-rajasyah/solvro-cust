import { Router } from "express";
import { z } from "zod";
import { Prisma, Priority, TaskStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hasPermission, requireAuth, requirePermission, type JwtPayload } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { dateInput, dateString } from "../lib/dateInput.js";
import { validate } from "../http/validate.js";
import { labelNameKey } from "../lib/labelNames.js";
import { ensureTaskVisible, projectVisibilityFilter } from "../lib/visibility.js";
import {
  isValidDayString,
  overdueBoundary,
  utcMidnightOf,
  utcMidnightOfDayString,
} from "../lib/dateBoundary.js";
import {
  assertLabelsInProject,
  assertSectionInProject,
  assertValidParent,
  closeGap,
  insertManyAfter,
  moveTaskWithinSiblings,
  siblingKeyEquals,
  type SiblingKey,
} from "../lib/taskOrdering.js";
import { lockProjectOrder } from "../lib/orderLock.js";
import { assertEpicNotOnSubtask, assertValidEpic } from "../lib/epics.js";
import { duplicateTaskTree } from "../lib/duplicate.js";
import { lockStatusListShared, resolveStatusWrite, statusDefInclude } from "../lib/taskStatuses.js";
import { ensureAssigneeIsMember } from "../lib/projectMembers.js";
import { assertUserExists } from "../lib/userRefs.js";
import { diffTaskChanges, recordActivity } from "../lib/activity.js";
import { filterActiveUsersWhoCanSeeProject, notifyForEvent } from "../lib/notifications.js";
import { storyPointsField } from "../lib/storyPoints.js";
import { collectTaskAttachmentKeys, deleteStoredObjects } from "../lib/attachments/cleanup.js";
import { bulkTasksSchema, bulkUpdateTasks, type BulkTasksBody } from "../lib/bulkTasks.js";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

// The value the client last saw for each field it is about to change (per-field
// optimistic check, see the PATCH handler). Each entry validates like the
// matching update field; `null` means "was empty".
const expectedTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  statusId: z.number().int().positive().optional(),
  priority: z.nativeEnum(Priority).optional(),
  // Compared, never written, and echoed back from the stored row — so no year
  // window (a row may predate it), only the shape check.
  startDate: dateString.nullable().optional(),
  dueDate: dateString.nullable().optional(),
  assignedToId: z.number().int().positive().nullable().optional(),
  sectionId: z.number().int().positive().nullable().optional(),
  epicId: z.number().int().positive().nullable().optional(),
  parentTaskId: z.number().int().positive().nullable().optional(),
  isMilestone: z.boolean().optional(),
  isCriticalPath: z.boolean().optional(),
  storyPoints: storyPointsField.optional(),
  labelIds: z.array(z.number().int().positive()).optional(),
});
type ExpectedTask = z.infer<typeof expectedTaskSchema>;

// The shape every task write returns; the stale_write 409 carries the current
// task in this same shape.
const taskResponseInclude = {
  assignedTo: { select: { id: true, username: true, email: true } },
  labels: true,
  section: { select: { id: true, name: true, position: true, color: true } },
  _count: { select: { subtasks: true, comments: true } },
  ...statusDefInclude,
} satisfies Prisma.TaskInclude;

const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    // Either names the new status: `statusId` (a workspace status) or the
    // legacy category-only `status`, which maps to that category's default
    // status. The server derives and writes BOTH columns (lib/taskStatuses.ts).
    status: z.nativeEnum(TaskStatus).optional(),
    statusId: z.number().int().positive().optional(),
    priority: z.nativeEnum(Priority).optional(),
    startDate: dateInput.nullable().optional(),
    dueDate: dateInput.nullable().optional(),
    isMilestone: z.boolean().optional(),
    isCriticalPath: z.boolean().optional(),
    storyPoints: storyPointsField.optional(),
    // baselineStartDate / baselineDueDate are intentionally NOT accepted here —
    // they are server-set only, snapshotted by POST /projects/:id/baseline.
    // Accepting them from clients would let any task:write user overwrite the
    // Gantt planned-vs-actual baseline. (The data mapping never wrote them, but
    // keep them out of the schema so that stays true.)
    assignedToId: z.number().int().positive().nullable().optional(),
    parentTaskId: z.number().int().positive().nullable().optional(),
    sectionId: z.number().int().positive().nullable().optional(),
    labelIds: z.array(z.number().int().positive()).optional(),
    epicId: z.number().int().positive().nullable().optional(),
    position: z.number().int().min(0).optional(),
    // Optional pin to one iTop ticket ref, e.g. "R-000123" (1-3 uppercase
    // letters, a dash, 4-8 digits — matches iTop's default ref format for
    // UserRequest/Incident). `null` clears it; the ref itself is never
    // validated against the local snapshot here (see
    // GET /itop/tickets/by-ref/:ref, which resolves it when present).
    itopTicketRef: z
      .string()
      .trim()
      .regex(/^[A-Z]{1,3}-\d{4,8}$/)
      .nullable()
      .optional(),
    // Per-field optimistic check: absent = last write wins.
    expected: expectedTaskSchema.optional(),
  })
  .refine((b) => !(b.isMilestone === true && b.dueDate === null), {
    message: "A milestone requires a due date",
    path: ["dueDate"],
  });

const dayString = z
  .string()
  .refine(isValidDayString, { message: "must be a valid yyyy-MM-dd date" });

const tasksListQuerySchema = z
  .object({
    // Category semantics (To do / In progress / Done), as before custom
    // statuses; `statusId` narrows to one workspace status.
    status: z.nativeEnum(TaskStatus).optional(),
    statusId: z.coerce.number().int().positive().optional(),
    priority: z.nativeEnum(Priority).optional(),
    assignedToId: z.coerce.number().int().positive().optional(),
    labelId: z.coerce.number().int().positive().optional(),
    // Label names, any-of, matched case-insensitively across the caller's
    // visible projects (one name is a different label row per project).
    // A single value arrives as a string, repeats as an array.
    labelName: z
      .union([z.string(), z.array(z.string())])
      .transform((v) => (Array.isArray(v) ? v : [v]))
      .pipe(z.array(z.string().trim().min(1).max(50)).min(1).max(20))
      .optional(),
    customerId: z.coerce.number().int().positive().optional(),
    // Tasks on projects whose TAM is this user (Overview TAM filter).
    tamId: z.coerce.number().int().positive().optional(),
    overdue: z
      .union([z.literal("true"), z.literal("false")])
      .transform((v) => v === "true")
      .optional(),
    // open=true adds "status is not DONE"; open=false is a no-op.
    open: z
      .union([z.literal("true"), z.literal("false")])
      .transform((v) => v === "true")
      .optional(),
    topLevel: z
      .union([z.literal("true"), z.literal("false")])
      .transform((v) => v === "true")
      .optional(),
    // Inclusive due-date day range ("yyyy-MM-dd"), see the handler.
    dueFrom: dayString.optional(),
    dueTo: dayString.optional(),
    // `position` (default) is board order; `due` is soonest first with
    // undated tasks last.
    sort: z.enum(["position", "due"]).optional(),
    // Rows to skip, for paging past the 200-row page. The order is total
    // (ties broken by id), so consecutive pages never overlap or skip.
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
    // Caller's local calendar day ("yyyy-MM-dd"), used only when overdue=true
    // — see lib/dateBoundary.ts for the full contract. Ignored otherwise.
    today: z
      .string()
      .refine(isValidDayString, { message: "today must be a valid yyyy-MM-dd date" })
      .optional(),
  })
  .refine((q) => !(q.dueFrom && q.dueTo) || q.dueFrom <= q.dueTo, {
    message: "dueFrom must not be after dueTo",
    path: ["dueFrom"],
  });

// At most 20 mentions per comment; duplicates collapse.
const MAX_MENTIONS = 20;
const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  mentionedUserIds: z
    .array(z.number().int().positive())
    .max(MAX_MENTIONS)
    .transform((ids) => [...new Set(ids)])
    .optional(),
});

type StaleConflict = { field: string; expected: unknown; current: unknown };

// Dates compare as calendar (UTC) days per lib/dateBoundary.ts, so a legacy
// row holding a non-midnight instant equals the same day sent as midnight.
const dayOf = (d: Date | null): number | null => (d === null ? null : utcMidnightOf(d).getTime());

/**
 * Compares the client's `expected` values against the locked task row.
 * Only fields present in `expected` are compared; `labelIds` as a set.
 */
function findStaleFields(
  expected: ExpectedTask,
  current: Prisma.TaskGetPayload<{ include: typeof taskResponseInclude }>,
): StaleConflict[] {
  const conflicts: StaleConflict[] = [];
  const scalarFields = [
    "title",
    "description",
    "status",
    "statusId",
    "priority",
    "assignedToId",
    "sectionId",
    "epicId",
    "parentTaskId",
    "isMilestone",
    "isCriticalPath",
    "storyPoints",
  ] as const;
  for (const field of scalarFields) {
    const want = expected[field];
    if (want !== undefined && want !== current[field]) {
      conflicts.push({ field, expected: want, current: current[field] });
    }
  }
  for (const field of ["startDate", "dueDate"] as const) {
    const want = expected[field];
    if (want !== undefined && dayOf(want) !== dayOf(current[field])) {
      conflicts.push({ field, expected: want, current: current[field] });
    }
  }
  if (expected.labelIds !== undefined) {
    const want = new Set(expected.labelIds);
    const have = current.labels.map((l) => l.id).sort((a, b) => a - b);
    if (want.size !== have.length || have.some((lid) => !want.has(lid))) {
      conflicts.push({ field: "labelIds", expected: expected.labelIds, current: have });
    }
  }
  return conflicts;
}

function buildVisibilityWhere(user: JwtPayload): Prisma.TaskWhereInput {
  const projectWhere = projectVisibilityFilter(user);
  if (Object.keys(projectWhere).length === 0) return {};
  return { project: projectWhere };
}

export const tasksRouter = Router();

// Task reads need `project:read` like the /projects router (routes/projects.ts):
// a member with no permissions (a PENDING account becomes one through task
// assignment) passed the visibility filter and could read task rows and
// comment bodies here.
tasksRouter.use(requireAuth, requirePermission("project:read"));

// Cross-project list with filters
tasksRouter.get("/", validate("query", tasksListQuerySchema), async (req, res) => {
  const {
    status,
    statusId,
    priority,
    assignedToId,
    labelId,
    labelName,
    customerId,
    tamId,
    overdue,
    open,
    topLevel,
    dueFrom,
    dueTo,
    sort,
    offset,
    today,
  } = req.query as unknown as z.infer<typeof tasksListQuerySchema>;

  const where: Prisma.TaskWhereInput = {
    ...buildVisibilityWhere(req.user!),
  };
  // Every filter that can overlap another appends to this list, so
  // combinations (overdue + status + open + a due range) intersect instead of
  // one overwriting the next.
  const and: Prisma.TaskWhereInput[] = [];
  if (priority) where.priority = priority;
  if (assignedToId) where.assignedToId = assignedToId;
  if (labelId) where.labels = { some: { id: labelId } };
  if (customerId) {
    // Any linked customer (docs/archive/plans/multi-customer-projects.md).
    where.project = {
      ...(where.project as object | undefined),
      customers: { some: { customerId } },
    };
  }
  if (tamId) {
    where.project = { ...(where.project as object | undefined), tamId };
  }
  if (topLevel) where.parentTaskId = null;
  if (status) and.push({ status });
  if (statusId) and.push({ statusId });
  if (open) and.push({ status: { not: "DONE" } });
  if (overdue) {
    // Overdue = due before the CALLER's calendar day (param `today`),
    // falling back to the server's UTC day; DONE always excluded. See
    // lib/dateBoundary.ts for the full contract (shared with
    // lib/portfolio.ts's isOverdue/daysOverdue).
    // Overdue is not Done: the not-DONE exclusion always applies, and an
    // explicit ?status filter narrows by INTERSECTION rather than being
    // silently overwritten — status=TODO&overdue=true returns overdue
    // TODOs; status=DONE&overdue=true is a contradiction and returns
    // nothing, by construction.
    and.push({ dueDate: { lt: overdueBoundary(today) } }, { status: { not: "DONE" } });
  }
  if (labelName) {
    // Names match by labelNameKey (trimmed, lower-cased, exact), never ILIKE:
    // `_` and `%` in a name stay literal. Only labels of projects the caller
    // can see are candidates; no matching id means no tasks, not all of them.
    const wanted = new Set(labelName.map(labelNameKey));
    const candidates = await prisma.label.findMany({
      where: { project: projectVisibilityFilter(req.user!) },
      select: { id: true, name: true },
    });
    const visible = candidates.filter((l) => wanted.has(labelNameKey(l.name)));
    and.push({ labels: { some: { id: { in: visible.map((l) => l.id) } } } });
  }
  if (dueFrom) and.push({ dueDate: { gte: utcMidnightOfDayString(dueFrom) } });
  if (dueTo) {
    // Inclusive of the last day: strictly before the next UTC midnight, which
    // also catches legacy rows holding a non-midnight instant on that day.
    const next = utcMidnightOfDayString(dueTo);
    next.setUTCDate(next.getUTCDate() + 1);
    and.push({ dueDate: { lt: next } });
  }
  if (and.length > 0) where.AND = and;

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    sort === "due"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]
      : [{ position: "asc" }, { id: "asc" }];

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy,
      include: {
        assignedTo: { select: { id: true, username: true, email: true } },
        labels: true,
        project: {
          select: {
            id: true,
            name: true,
            // The row's customer is the project's primary.
            customers: {
              where: { isPrimary: true },
              take: 1,
              select: { customer: { select: { id: true, name: true } } },
            },
          },
        },
        _count: { select: { subtasks: true, comments: true } },
        ...statusDefInclude,
      },
      skip: offset ?? 0,
      take: 200,
    }),
    // Full match count (ignores take and offset) so the UI can say "200 of N".
    prisma.task.count({ where }),
  ]);
  res.setHeader("X-Total-Count", String(total));
  res.json(
    tasks.map((t) => {
      const { customers, ...project } = t.project;
      return { ...t, project: { ...project, customer: customers[0]?.customer ?? null } };
    }),
  );
});

// One task by id, for the task page. The same row as a list item (the project
// has the same { id, name, customer } shape) plus its `section`. A hidden task
// answers 404 exactly like a missing one.
tasksRouter.get("/:id", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const task = await prisma.task.findFirst({
    where: { id, project: projectVisibilityFilter(req.user!) },
    include: {
      ...taskResponseInclude,
      project: {
        select: {
          id: true,
          name: true,
          // The row's customer is the project's primary, as in the list.
          customers: {
            where: { isPrimary: true },
            take: 1,
            select: { customer: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!task) throw new HttpError(404, "not_found", "Task not found");
  const { customers, ...project } = task.project;
  res.json({ ...task, project: { ...project, customer: customers[0]?.customer ?? null } });
});

// Registered before the "/:id" routes so a literal "bulk" is never read as an id.
tasksRouter.post(
  "/bulk",
  requirePermission("task:write"),
  validate("body", bulkTasksSchema),
  async (req, res) => {
    const updated = await bulkUpdateTasks(req.user!, req.body as BulkTasksBody);
    res.json({ updated });
  },
);

tasksRouter.patch(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  validate("body", updateTaskSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateTaskSchema>;

    // Visibility first: a caller who can't see the task must get a 404 before
    // any field-level validation, so the self-parent guard can't be used as a
    // 400-vs-404 existence oracle for tasks on projects they can't see.
    await ensureTaskVisible(req.user!, id);

    if (body.parentTaskId === id) {
      throw new HttpError(400, "invalid_parent", "Task cannot be its own parent");
    }

    // Everything below that depends on the task's pre-write state. Derived from
    // the row read under lock inside the transaction, so a concurrent writer
    // cannot make the ordering / milestone / assignee logic (or the activity
    // diff) act on stale values.
    const derive = (cur: {
      projectId: number;
      status: TaskStatus;
      parentTaskId: number | null;
      isMilestone: boolean;
      startDate: Date | null;
      dueDate: Date | null;
      assignedToId: number | null;
    }) => {
      const nextParentTaskId =
        body.parentTaskId !== undefined ? body.parentTaskId : cur.parentTaskId;
      const oldKey: SiblingKey = { projectId: cur.projectId, parentTaskId: cur.parentTaskId };
      const newKey: SiblingKey = { projectId: cur.projectId, parentTaskId: nextParentTaskId };
      return {
        cur,
        nextParentTaskId,
        oldKey,
        newKey,
        // A patch only re-orders when it sets an explicit position OR moves the
        // task to a different sibling list (i.e. a re-parent). A status-only
        // change is NOT a reorder for any task, top-level or subtask: sibling
        // lists are keyed on parentTaskId alone (status doesn't partition them),
        // so siblingKeyEquals reports the keys equal and the row keeps its slot.
        // Previously a top-level task's key included status, so any status
        // change re-appended the row to the end of its destination column —
        // that's the exact behavior this task removes.
        touchesOrdering: body.position !== undefined || !siblingKeyEquals(oldKey, newKey),
      };
    };

    const updated = await prisma.$transaction(async (tx) => {
      // A write that names a status shares the status-list lock before any
      // other lock (see lib/taskStatuses.ts), so an admin category change or
      // delete cannot interleave with it.
      if (body.status !== undefined || body.statusId !== undefined) await lockStatusListShared(tx);
      // A reorder or re-parent re-packs the project's task order, and linking
      // an epic or section (a non-null id; null takes no key-share lock) locks
      // that row, which an epic or section delete holds exclusively while it
      // updates this task. Take the order lock before the row lock below (see
      // lib/orderLock.ts for why the order matters). The project id is read
      // without a lock; it never changes.
      if (
        body.position !== undefined ||
        body.parentTaskId !== undefined ||
        body.epicId != null ||
        body.sectionId != null
      ) {
        const [row] = await tx.$queryRaw<{ project_id: number }[]>`SELECT project_id FROM tasks WHERE id = ${id}`;
        if (row) await lockProjectOrder(tx, "tasks", row.project_id);
      }
      // Lock the row before reading it, so two concurrent saves serialise and
      // each one sees (and diffs against) the other's result: the optimistic
      // check below, the assignee-change detection and the activity event all
      // work from the locked row. FOR NO KEY UPDATE, not FOR UPDATE: it still
      // excludes another save (and plain UPDATEs), but does not conflict with
      // the FOR KEY SHARE an FK check takes — a labels-only write (DELETE +
      // INSERT on the join table, never an UPDATE of this row), a comment or a
      // subtask insert. FOR UPDATE deadlocked against those (40P01 -> 500).
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${id} FOR NO KEY UPDATE`;
      const before = await tx.task.findUniqueOrThrow({
        where: { id },
        include: taskResponseInclude,
      });
      // Per-field optimistic check, before anything is written: reject if any
      // field the client says it last saw has since changed. Throwing rolls the
      // transaction back, so nothing (incl. the assignee-membership side
      // effect) lands.
      if (body.expected !== undefined) {
        const conflicts = findStaleFields(body.expected, before);
        if (conflicts.length > 0) {
          throw new HttpError(
            409,
            "stale_write",
            "Task was changed by someone else after it was loaded",
            { conflicts, task: before },
          );
        }
      }
      const state = derive(before);
      const beforeTask = before;
      // Records the update (skipped when nothing but position changed) in this
      // same transaction, then hands the row back.
      const finish = async (after: typeof beforeTask) => {
        const event = await recordActivity(tx, {
          projectId: beforeTask.projectId,
          actorId: req.user!.sub,
          entityType: "task",
          entityId: id,
          action: "updated",
          entityLabel: after.title,
          changes: diffTaskChanges(beforeTask, after),
        });
        // Notifies a newly assigned user (the row lock above means two
        // overlapping identical assigns see one change, so one notification).
        await notifyForEvent(tx, event);
        return after;
      };
      const { cur, nextParentTaskId, oldKey, newKey, touchesOrdering } = state;

      // The status this patch writes (statusId, or a bare category mapped to
      // its default status) — null when the patch leaves the status alone.
      // A bare category equal to the task's CURRENT one is "no change" (the
      // Kanban sends it with every within-column reorder), so a task on a
      // custom status keeps it instead of falling back to the category default.
      const nextStatus =
        body.statusId === undefined && body.status === cur.status
          ? null
          : await resolveStatusWrite(tx, body);

      // A milestone needs a due date. The body schema only catches
      // `isMilestone: true` with `dueDate: null` in the same request; the
      // other two routes in (flagging an undated task, or clearing the date
      // of a stored milestone) need the locked row. Checked only when this
      // patch touches one of the two fields, so an unrelated edit of a
      // legacy undated milestone still saves.
      if (
        (body.isMilestone === true || body.dueDate === null) &&
        (body.isMilestone ?? cur.isMilestone) &&
        (body.dueDate !== undefined ? body.dueDate : cur.dueDate) === null
      ) {
        throw new HttpError(400, "validation_error", "A milestone requires a due date", {
          formErrors: [],
          fieldErrors: { dueDate: ["A milestone requires a due date"] },
        });
      }

      // The patch can carry one date only (the panel sends just the changed
      // field), so check the merged result. A milestone is exempt: its start
      // is forced to its due date below. Only when this patch touches a date,
      // so an unrelated edit of a legacy row with due < start still saves.
      if (body.startDate !== undefined || body.dueDate !== undefined) {
        const mergedStart = body.startDate !== undefined ? body.startDate : cur.startDate;
        const mergedDue = body.dueDate !== undefined ? body.dueDate : cur.dueDate;
        if (
          !(body.isMilestone ?? cur.isMilestone) &&
          mergedStart &&
          mergedDue &&
          utcMidnightOf(mergedDue).getTime() < utcMidnightOf(mergedStart).getTime()
        ) {
          throw new HttpError(400, "validation_error", "Due date must not be before the start date", {
            formErrors: [],
            fieldErrors: { dueDate: ["Due date must not be before the start date"] },
          });
        }
      }

      if (nextParentTaskId !== null) {
        await assertValidParent(tx, cur.projectId, id, nextParentTaskId);
      }
      if (body.sectionId != null) {
        await assertSectionInProject(tx, cur.projectId, body.sectionId);
      }
      if (body.labelIds && body.labelIds.length > 0) {
        await assertLabelsInProject(tx, cur.projectId, body.labelIds);
      }

      // An explicit epicId is validated the same way create is (400
      // epic_on_subtask, checked unconditionally against the EFFECTIVE next
      // parent — whether that parent comes from this same request's
      // parentTaskId or was already set — so `{ parentTaskId: X, epicId: Y }`
      // 400s here exactly like it does on create, instead of silently
      // clearing); non-null also must belong to the same project (400
      // epic_not_found). `epicId: null` always clears it, regardless of
      // parent. Only when epicId is ABSENT from the body does re-parenting
      // to non-null implicitly clear it (docs/archive/plans/epics-spec.md §4 — a
      // subtask never carries its own epic, it inherits the parent's for
      // display); an absent epicId with no re-parent leaves it untouched.
      let epicIdUpdate: number | null | undefined;
      if (body.epicId !== undefined) {
        if (body.epicId !== null) {
          assertEpicNotOnSubtask(body.epicId, nextParentTaskId);
          await assertValidEpic(tx, cur.projectId, body.epicId);
        }
        epicIdUpdate = body.epicId;
      } else if (body.parentTaskId !== undefined && body.parentTaskId !== null) {
        epicIdUpdate = null;
      }

      if (body.assignedToId != null) {
        await assertUserExists(tx, body.assignedToId, "assignee_not_found", "Assignee not found");
      }

      // Assigning someone who cannot see the project adds them as a member
      // (same transaction as the task write).
      // Only when the assignee actually changes: the edit form re-sends the
      // current assignee on every save, and that must not re-add a member who
      // was removed.
      if (body.assignedToId != null && body.assignedToId !== cur.assignedToId) {
        const added = await ensureAssigneeIsMember(
          tx,
          cur.projectId,
          body.assignedToId,
          req.user!.sub,
        );
        if (added) {
          await recordActivity(tx, {
            projectId: cur.projectId,
            actorId: req.user!.sub,
            entityType: "member",
            entityId: body.assignedToId,
            action: "added",
            entityLabel: added.username,
          });
        }
      }

      const data: Prisma.TaskUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if (body.description !== undefined) data.description = body.description;
      if (body.priority !== undefined) data.priority = body.priority;
      if (body.startDate !== undefined) data.startDate = body.startDate;
      if (body.dueDate !== undefined) data.dueDate = body.dueDate;
      if (body.isMilestone !== undefined) data.isMilestone = body.isMilestone;
      if (body.isCriticalPath !== undefined) data.isCriticalPath = body.isCriticalPath;
      if (body.storyPoints !== undefined) data.storyPoints = body.storyPoints;
      if (body.itopTicketRef !== undefined) data.itopTicketRef = body.itopTicketRef;
      // Milestone due-date lockstep: whatever this patch results in, a
      // milestone with a due date must have startDate === dueDate.
      const willBeMilestone = body.isMilestone ?? cur.isMilestone;
      const effectiveDue =
        body.dueDate !== undefined ? body.dueDate : cur.dueDate;
      if (willBeMilestone && effectiveDue) data.startDate = effectiveDue;
      if (body.assignedToId !== undefined) {
        data.assignedTo = body.assignedToId === null
          ? { disconnect: true }
          : { connect: { id: body.assignedToId } };
      }
      if (body.parentTaskId !== undefined) {
        data.parent = body.parentTaskId === null
          ? { disconnect: true }
          : { connect: { id: body.parentTaskId } };
      }
      if (body.sectionId !== undefined) {
        data.section = body.sectionId === null
          ? { disconnect: true }
          : { connect: { id: body.sectionId } };
      }
      if (body.labelIds !== undefined) {
        data.labels = { set: body.labelIds.map((lid) => ({ id: lid })) };
      }
      if (epicIdUpdate !== undefined) {
        data.epic = epicIdUpdate === null ? { disconnect: true } : { connect: { id: epicIdUpdate } };
      }

      if (touchesOrdering) {
        // Status is never part of the sibling key, so it can't be what makes
        // touchesOrdering true here — this branch only runs for an explicit
        // position or a re-parent. Still apply nextStatus: a caller can send
        // status and position together (e.g. drag a card to a new column at
        // a specific row), and that combined write must land in the same
        // update as the position/parent change.
        if (nextStatus) {
          data.status = nextStatus.status;
          data.statusDef = { connect: { id: nextStatus.statusId } };
        }

        // Apply the non-ordering fields (and the parent/status change) first,
        // then compute the new dense position for this row and every sibling
        // it displaced. moveTaskWithinSiblings issues its own updates for
        // position, so exclude it from `data` to avoid a redundant write.
        await tx.task.update({ where: { id }, data });
        const finalPosition = await moveTaskWithinSiblings(
          tx,
          id,
          oldKey,
          newKey,
          body.position,
        );
        return finish(
          await tx.task.update({
            where: { id },
            data: { position: finalPosition },
            include: taskResponseInclude,
          }),
        );
      }

      if (nextStatus) {
        data.status = nextStatus.status;
        data.statusDef = { connect: { id: nextStatus.statusId } };
      }
      return finish(
        await tx.task.update({
          where: { id },
          data,
          include: taskResponseInclude,
        }),
      );
    });

    res.json(updated);
  },
);

tasksRouter.delete(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);
    const storedKeys = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id },
        select: { projectId: true, title: true, parentTaskId: true },
      });
      if (!task) throw new HttpError(404, "not_found", "Task not found");
      // The delete re-packs the sibling list: take the order lock first.
      await lockProjectOrder(tx, "tasks", task.projectId);
      // Attachment rows go with the task (cascade); their files are removed
      // after the commit. Lock the task and its subtasks first: an upload
      // commits before the keys are read, or finds the task gone.
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${id} OR parent_task_id = ${id} FOR UPDATE`;
      const keys = await collectTaskAttachmentKeys(tx, id);
      await tx.task.delete({ where: { id } });
      await closeGap(tx, { projectId: task.projectId, parentTaskId: task.parentTaskId }, id);
      await recordActivity(tx, {
        projectId: task.projectId,
        actorId: req.user!.sub,
        entityType: "task",
        entityId: id,
        action: "deleted",
        entityLabel: task.title,
      });
      return keys;
    });
    void deleteStoredObjects(storedKeys);
    res.status(204).end();
  },
);

// Duplicate a task (and, when it's a top-level task, its subtasks) — no
// body. A top-level source copies with its subtasks nested under the copy;
// a subtask source copies just that one row under the same parentTaskId.
// See docs/archive/plans/duplicate-tasks-sections.md §3-4 for the settled field
// rules (status -> TODO, baseline cleared, dependencies dropped, comments
// never copied) implemented by duplicateTaskTree.
tasksRouter.post(
  "/:id/duplicate",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);

    const newTask = await prisma.$transaction(async (tx) => {
      await lockStatusListShared(tx);
      const source = await tx.task.findUniqueOrThrow({
        where: { id },
        select: { projectId: true, parentTaskId: true },
      });
      // Wait for a concurrent reorder now, while the 5 s transaction budget
      // is still whole, not after the tree copy (insertManyAfter takes the
      // same lock again, harmlessly).
      await lockProjectOrder(tx, "tasks", source.projectId);

      const idMap = await duplicateTaskTree(tx, [id]);
      const newId = idMap.get(id)!;

      // The copy lands at the end of the same sibling list duplicateTaskTree
      // appended it to (source's own list, since no overrides were passed) —
      // move it to right after the source. Placed by the source's identity
      // (insertManyAfter), not `source.position + 1` as an index: positions
      // written before DELETE /tasks/:id closed its gap may still be sparse,
      // so a stored position can point at the wrong row. insertManyAfter
      // re-packs the whole list dense regardless.
      const key: SiblingKey = { projectId: source.projectId, parentTaskId: source.parentTaskId };
      await insertManyAfter(tx, key, id, [newId]);

      const copy = await tx.task.findUniqueOrThrow({
        where: { id: newId },
        include: {
          assignedTo: { select: { id: true, username: true, email: true } },
          labels: true,
          section: { select: { id: true, name: true, position: true, color: true } },
          _count: { select: { subtasks: true, comments: true } },
          ...statusDefInclude,
        },
      });
      // One event for the copy itself (its subtasks ride along unlogged).
      await recordActivity(tx, {
        projectId: source.projectId,
        actorId: req.user!.sub,
        entityType: "task",
        entityId: newId,
        action: "created",
        entityLabel: copy.title,
      });
      return copy;
    });

    res.status(201).json(newTask);
  },
);

// Comments thread
tasksRouter.get(
  "/:id/comments",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);
    const comments = await prisma.comment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, username: true, email: true } },
        inboundHook: { select: { id: true, name: true } },
      },
    });
    res.json(comments);
  },
);

tasksRouter.post(
  "/:id/comments",
  // Commenting is its own permission (user decision 2026-10-22): read-only
  // STAKEHOLDER keeps it, a PENDING member does not. Seeded on TAM and
  // STAKEHOLDER (prisma/seed.ts); a custom role must be granted it explicitly.
  requirePermission("task:comment"),
  validate("params", idParamSchema),
  validate("body", createCommentSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { body, mentionedUserIds: requestedMentions = [] } = req.body as z.infer<
      typeof createCommentSchema
    >;
    await ensureTaskVisible(req.user!, id);
    const comment = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id },
        select: { projectId: true, title: true, assignedToId: true },
      });
      if (!task) throw new HttpError(404, "not_found", "Task not found");
      // Keep only mentions of active users who can see the project; unknown,
      // inactive and hidden ids are dropped silently. A self-mention is kept
      // (so the chip renders) — notifyForEvent never notifies the actor.
      const visible = await filterActiveUsersWhoCanSeeProject(tx, task.projectId, requestedMentions);
      const mentionedUserIds = requestedMentions.filter((uid) => visible.has(uid));
      const created = await tx.comment.create({
        data: {
          taskId: id,
          authorId: req.user!.sub,
          body,
          mentionedUserIds,
        },
        include: {
          author: { select: { id: true, username: true, email: true } },
          inboundHook: { select: { id: true, name: true } },
        },
      });
      // Never the comment body or the mention ids: the event carries the
      // comment id and the task it belongs to (so the log can link to it).
      const event = await recordActivity(tx, {
        projectId: task.projectId,
        actorId: req.user!.sub,
        entityType: "comment",
        entityId: created.id,
        action: "created",
        entityLabel: task.title,
        changes: { taskId: id },
      });
      // The task's current assignee hears about a comment by someone else.
      // Mentions win over `commented` for the same user (one row per event).
      await notifyForEvent(tx, event, { taskAssigneeId: task.assignedToId, mentionedUserIds });
      return created;
    });
    res.status(201).json(comment);
  },
);

const commentParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  commentId: z.coerce.number().int().positive(),
});

const commentInclude = {
  author: { select: { id: true, username: true, email: true } },
  inboundHook: { select: { id: true, name: true } },
} as const;

// Same rules as the project notes routes: only the author edits, the author or
// an admin deletes (docs/archive/plans/comment-edit-delete.md).
tasksRouter.patch(
  "/:id/comments/:commentId",
  requirePermission("task:comment"),
  validate("params", commentParamSchema),
  validate("body", createCommentSchema),
  async (req, res) => {
    const { id, commentId } = req.params as unknown as z.infer<typeof commentParamSchema>;
    const { body, mentionedUserIds: requestedMentions = [] } = req.body as z.infer<
      typeof createCommentSchema
    >;
    await ensureTaskVisible(req.user!, id);
    const comment = await prisma.$transaction(async (tx) => {
      const existing = await tx.comment.findFirst({ where: { id: commentId, taskId: id } });
      if (!existing) throw new HttpError(404, "comment_not_found", "Comment not found");
      if (existing.authorId !== req.user!.sub) {
        throw new HttpError(403, "not_comment_author", "Only the author may edit this comment");
      }
      if (existing.source === "incoming") {
        throw new HttpError(
          409,
          "comment_not_editable",
          "A comment from an incoming webhook cannot be edited",
        );
      }
      const task = await tx.task.findUnique({
        where: { id },
        select: { projectId: true, title: true },
      });
      if (!task) throw new HttpError(404, "not_found", "Task not found");
      // An edit means the body changed. A save with the same body is a full
      // no-op, whatever mentions it sends: nothing is stored, logged or sent.
      if (body === existing.body) {
        return tx.comment.findUniqueOrThrow({ where: { id: commentId }, include: commentInclude });
      }
      const visible = await filterActiveUsersWhoCanSeeProject(tx, task.projectId, requestedMentions);
      const mentionedUserIds = requestedMentions.filter((uid) => visible.has(uid));
      const stored = new Set(existing.mentionedUserIds);

      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { body, mentionedUserIds, editedAt: new Date() },
        include: commentInclude,
      });
      // Never the comment body or the mention ids, as on create.
      const event = await recordActivity(tx, {
        projectId: task.projectId,
        actorId: req.user!.sub,
        entityType: "comment",
        entityId: commentId,
        action: "updated",
        entityLabel: task.title,
        changes: { taskId: id },
      });
      // An edit is not a new comment: only mentions it adds are notified, and
      // the task assignee is not (notifyForEvent adds `commented` on create only).
      await notifyForEvent(tx, event, {
        mentionedUserIds: mentionedUserIds.filter((uid) => !stored.has(uid)),
      });
      return updated;
    });
    res.json(comment);
  },
);

tasksRouter.delete(
  "/:id/comments/:commentId",
  requirePermission("task:comment"),
  validate("params", commentParamSchema),
  async (req, res) => {
    const { id, commentId } = req.params as unknown as z.infer<typeof commentParamSchema>;
    await ensureTaskVisible(req.user!, id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.comment.findFirst({ where: { id: commentId, taskId: id } });
      if (!existing) throw new HttpError(404, "comment_not_found", "Comment not found");
      if (existing.authorId !== req.user!.sub && !hasPermission(req.user!, "*")) {
        throw new HttpError(
          403,
          "not_comment_author",
          "Only the author or an admin may delete this comment",
        );
      }
      const task = await tx.task.findUnique({
        where: { id },
        select: { projectId: true, title: true },
      });
      if (!task) throw new HttpError(404, "not_found", "Task not found");
      await tx.comment.delete({ where: { id: commentId } });
      // `source` rides along because the row is gone when the webhook
      // dispatcher runs and it must skip comments an incoming URL wrote.
      await recordActivity(tx, {
        projectId: task.projectId,
        actorId: req.user!.sub,
        entityType: "comment",
        entityId: commentId,
        action: "deleted",
        entityLabel: task.title,
        changes: { taskId: id, ...(existing.source ? { source: existing.source } : {}) },
      });
    });
    res.status(204).send();
  },
);
