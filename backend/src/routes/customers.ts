import { Router } from "express";
import { z } from "zod";
import { Prisma, WeeklyHealth, WeeklyStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { requireAuth, requirePermission, hasPermission, type JwtPayload } from "../http/auth.js";
// services router lives in ./services.ts; this file owns the customer-side mapping.
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { isValidDayString, utcMidnightOf, utcMidnightOfDayString } from "../lib/dateBoundary.js";
import { isMonday } from "../lib/isoWeek.js";
import {
  customerVisibilityFilter,
  ensureCustomerVisible,
  projectVisibilityFilter,
} from "../lib/visibility.js";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  accountManager: z.string().max(200).optional(),
  solutionArchitect: z.string().max(200).optional(),
  description: z.string().min(1, "Description is required").max(5000),
  // TAM ownership gate is `project:write` (Decision 8) — the same permission
  // this router already requires for writes; there is no `customer:write`.
  tamId: z.number().int().positive().nullable().optional(),
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  accountManager: z.string().max(200).optional(),
  solutionArchitect: z.string().max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  tamId: z.number().int().positive().nullable().optional(),
});

/** 400 `tam_not_found` instead of a raw P2003 → 500 on a bogus tamId. */
async function assertTamExists(tamId: number): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: tamId }, select: { id: true } });
  if (!user) {
    throw new HttpError(400, "tam_not_found", "Assigned TAM does not exist");
  }
}

const dayStringSchema = z
  .string()
  .refine(isValidDayString, { message: "Invalid date (expected yyyy-MM-dd)" });

const customerNoteListQuerySchema = z.object({
  from: dayStringSchema.optional(),
  to: dayStringSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const titleSchema = z.string().trim().min(1).max(120);

const createCustomerNoteSchema = z.object({
  body: z.string().min(1).max(4000),
  noteDate: dayStringSchema.optional(),
  title: titleSchema,
});

const updateCustomerNoteSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  title: titleSchema.optional(),
});

const customerNoteParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  noteId: z.coerce.number().int().positive(),
});

const customerNoteInclude = {
  author: { select: { id: true, username: true } },
} as const;

const weeklyUpdateListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(52).optional(),
});

const weeklyUpdateParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  weekStart: dayStringSchema,
});

// One Mid-week highlight row (D5/D6 in docs/archive/plans/weekly-sync-highlight-rows.md):
// title is one line, 1–200 characters after trim, no \r or \n. The 200 limit
// counts code points (not UTF-16 units, what z.string().max() counts), to
// match the migration's LEFT(first_line, 200), the VarChar(200) column, and
// the frontend's cut() ([...s].slice(0, 200)) — a title cannot be rejected
// here for exceeding a limit those never enforced in the first place.
// Detail/risk/action follow the same ≤8000, trim-and-null-when-empty rule as
// every other sync text field (normalizeText, applied when the row is
// written).
const highlightInputSchema = z.object({
  title: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, "title is required")
        .refine((s) => [...s].length <= 200, {
          message: "title must be 200 characters or fewer",
        })
        .refine((s) => !/[\r\n]/.test(s), { message: "title must be one line" }),
    ),
  detail: z.string().max(8000).nullable().optional(),
  risk: z.string().max(8000).nullable().optional(),
  action: z.string().max(8000).nullable().optional(),
});

// One Reflection achievement row (D5/D6 in docs/archive/plans/weekly-sync-achievement-rows.md):
// same title rule as a highlight (trim, 1-200 code points, one line), and
// the same ≤8000 trim-and-null-when-empty rule for its five texts.
const achievementInputSchema = z.object({
  title: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, "title is required")
        .refine((s) => [...s].length <= 200, {
          message: "title must be 200 characters or fewer",
        })
        .refine((s) => !/[\r\n]/.test(s), { message: "title must be one line" }),
    ),
  detail: z.string().max(8000).nullable().optional(),
  outstandingIssue: z.string().max(8000).nullable().optional(),
  lessonLearned: z.string().max(8000).nullable().optional(),
  nextWeekFocus: z.string().max(8000).nullable().optional(),
  managerDecision: z.string().max(8000).nullable().optional(),
});

const saveWeeklyUpdateSchema = z.object({
  health: z.nativeEnum(WeeklyHealth).nullable().optional(),
  status: z.nativeEnum(WeeklyStatus).optional(),
  // Trim before the length check so a value that's exactly 120 characters
  // after trimming isn't rejected for padding that normalizeText would
  // have stripped anyway.
  category: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(120))
    .nullable()
    .optional(),
  // Omitted = the stored list is untouched. Present (including `[]`) =
  // replaces the whole list, in array order, in one transaction (D6 in
  // docs/archive/plans/weekly-sync-highlight-rows.md).
  highlights: z.array(highlightInputSchema).max(20).optional(),
  // Same replace-in-order contract as highlights, for the Reflection
  // achievement list (D6 in docs/archive/plans/weekly-sync-achievement-rows.md).
  achievements: z.array(achievementInputSchema).max(20).optional(),
});

// Every Mid-week/Reflection text field goes through this one normalisation:
// `undefined` (the key was omitted) leaves the stored value unchanged;
// `null` or a whitespace-only string clears it to `null`; anything else is
// stored trimmed. A field is NEVER stored as `""`.
function normalizeText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export const customersRouter = Router();

customersRouter.use(requireAuth);

customersRouter.get("/", async (req, res) => {
  const user = req.user!;
  const customers = await prisma.customer.findMany({
    where: customerVisibilityFilter(user),
    orderBy: { name: "asc" },
    include: {
      tam: { select: { id: true, username: true } },
      // A visible customer can still carry projects the caller can't see
      // (that's exactly how "attached" visibility works — Decision 1's
      // third arm) — the count must match what /:id will actually show
      // them, not every project the customer has.
      _count: { select: { projects: { where: projectVisibilityFilter(user) } } },
    },
  });
  res.json(customers);
});

// A function of the caller, not a module-level const: the nested `projects`
// list (and its count) must itself be scoped to projectVisibilityFilter, so
// a customer reached only through one visible project (Decision 1's third
// arm) never leaks the rest of that customer's projects.
function customerInclude(user: JwtPayload) {
  return {
    projects: {
      where: projectVisibilityFilter(user),
      orderBy: { updatedAt: "desc" } as const,
      include: {
        tam: { select: { id: true, username: true } },
        _count: { select: { tasks: true } },
      },
    },
    services: {
      orderBy: { service: { name: "asc" } } as const,
      include: { service: true },
    },
    tam: { select: { id: true, username: true } },
    _count: { select: { projects: { where: projectVisibilityFilter(user) } } },
  } as const;
}

customersRouter.get("/:id", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const customer = await prisma.customer.findFirst({
    where: { id, ...customerVisibilityFilter(req.user!) },
    include: customerInclude(req.user!),
  });
  if (!customer) {
    throw new HttpError(404, "customer_not_found", "Customer not found");
  }
  res.json(customer);
});

const assignServicesSchema = z.object({
  assignments: z.array(
    z.object({
      serviceId: z.number().int().positive(),
      tools: z.array(z.string().trim().min(1).max(100)).default([]),
    }),
  ),
});

customersRouter.put(
  "/:id/services",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", assignServicesSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { assignments } = req.body as z.infer<typeof assignServicesSchema>;
    await ensureCustomerVisible(req.user!, id);

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
      prisma.customerService.deleteMany({
        where: {
          customerId: id,
          ...(desiredIds.length > 0 && { serviceId: { notIn: desiredIds } }),
        },
      }),
      ...assignments.map((a) =>
        prisma.customerService.upsert({
          where: {
            customerId_serviceId: { customerId: id, serviceId: a.serviceId },
          },
          create: { customerId: id, serviceId: a.serviceId, tools: a.tools },
          update: { tools: a.tools },
        }),
      ),
    ]);

    const updated = await prisma.customer.findUniqueOrThrow({
      where: { id },
      include: customerInclude(req.user!),
    });
    res.json(updated);
  },
);

customersRouter.post(
  "/",
  requirePermission("project:write"),
  validate("body", createCustomerSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof createCustomerSchema>;
    const user = req.user!;

    // Decision 4: an omitted tamId defaults to the creator, so a TAM can
    // never create a customer they immediately can't see. Explicit `null`
    // (an intentionally unowned customer) is only allowed for view-all
    // users — anyone else gets 400 tam_required instead of silently
    // creating a customer nobody owns.
    let tamId: number | null;
    if (body.tamId === undefined) {
      tamId = user.sub;
    } else if (body.tamId === null) {
      if (!hasPermission(user, "project:view-all")) {
        throw new HttpError(
          400,
          "tam_required",
          "A TAM must be assigned unless you can view all customers",
        );
      }
      tamId = null;
    } else {
      await assertTamExists(body.tamId);
      tamId = body.tamId;
    }
    const data: Prisma.CustomerCreateInput = {
      name: body.name,
      accountManager: body.accountManager || null,
      solutionArchitect: body.solutionArchitect || null,
      description: body.description,
    };
    if (tamId != null) {
      data.tam = { connect: { id: tamId } };
    }
    const customer = await prisma.customer.create({
      data,
      include: { tam: { select: { id: true, username: true } } },
    });
    res.status(201).json(customer);
  },
);

customersRouter.patch(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", updateCustomerSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof updateCustomerSchema>;
    const user = req.user!;

    // Same visibility preamble as ensureCustomerVisible, but read inline so
    // the current tamId is on hand for the un-owning guard just below —
    // avoids a second round trip for the same row.
    const existing = await prisma.customer.findFirst({
      where: { id, ...customerVisibilityFilter(user) },
      select: { tamId: true },
    });
    if (!existing) {
      throw new HttpError(404, "customer_not_found", "Customer not found");
    }

    const data: Prisma.CustomerUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.accountManager !== undefined)
      data.accountManager = body.accountManager || null;
    if (body.solutionArchitect !== undefined)
      data.solutionArchitect = body.solutionArchitect || null;
    if (body.description !== undefined) data.description = body.description;
    if (body.tamId !== undefined) {
      if (body.tamId === null) {
        // Un-owning must not be a side door around Decision 4's "a TAM can
        // never create a customer they can't see": clearing an OWNED
        // customer's tamId is a view-all-only move, same as creating one
        // unowned. An already-unowned customer re-saving `tamId: null`
        // (the edit form's steady state) must keep working for everyone.
        if (existing.tamId !== null && !hasPermission(user, "project:view-all")) {
          throw new HttpError(
            400,
            "tam_required",
            "A TAM must be assigned unless you can view all customers",
          );
        }
        data.tam = { disconnect: true };
      } else {
        await assertTamExists(body.tamId);
        data.tam = { connect: { id: body.tamId } };
      }
    }
    const updated = await prisma.customer.update({
      where: { id },
      data,
      include: { tam: { select: { id: true, username: true } } },
    });
    res.json(updated);
  },
);

customersRouter.delete(
  "/:id",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureCustomerVisible(req.user!, id);
    // onDelete: SetNull on Project.customerId — projects survive, customer link clears.
    await prisma.customer.delete({ where: { id } });
    res.status(204).end();
  },
);

// ---- Operations notes (customer-scoped, no project) ------------------------
// Same author-only edit / wildcard-delete rule as ProjectNote (Decision 9).

customersRouter.get(
  "/:id/notes",
  requirePermission("project:read"),
  validate("params", idParamSchema),
  validate("query", customerNoteListQuerySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { from, to, limit } = req.query as unknown as z.infer<
      typeof customerNoteListQuerySchema
    >;
    await ensureCustomerVisible(req.user!, id);

    const noteDateFilter: Prisma.DateTimeFilter = {};
    if (from) noteDateFilter.gte = utcMidnightOfDayString(from);
    if (to) noteDateFilter.lte = utcMidnightOfDayString(to);

    const notes = await prisma.customerNote.findMany({
      where: {
        customerId: id,
        ...((from || to) && { noteDate: noteDateFilter }),
      },
      orderBy: [{ noteDate: "desc" }, { id: "desc" }],
      take: limit ?? 50,
      include: customerNoteInclude,
    });
    res.json(notes);
  },
);

customersRouter.post(
  "/:id/notes",
  requirePermission("project:write"),
  validate("params", idParamSchema),
  validate("body", createCustomerNoteSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const body = req.body as z.infer<typeof createCustomerNoteSchema>;
    await ensureCustomerVisible(req.user!, id);

    const note = await prisma.customerNote.create({
      data: {
        customerId: id,
        authorId: req.user!.sub,
        noteDate: body.noteDate ? utcMidnightOfDayString(body.noteDate) : utcMidnightOf(Date.now()),
        body: body.body,
        title: body.title,
      },
      include: customerNoteInclude,
    });
    res.status(201).json(note);
  },
);

customersRouter.patch(
  "/:id/notes/:noteId",
  requirePermission("project:write"),
  validate("params", customerNoteParamSchema),
  validate("body", updateCustomerNoteSchema),
  async (req, res) => {
    const { id, noteId } = req.params as unknown as z.infer<
      typeof customerNoteParamSchema
    >;
    const body = req.body as z.infer<typeof updateCustomerNoteSchema>;
    await ensureCustomerVisible(req.user!, id);

    const existing = await prisma.customerNote.findUnique({ where: { id: noteId } });
    if (!existing || existing.customerId !== id) {
      throw new HttpError(404, "note_not_found", "Note not found");
    }
    // Edit is author-only, full stop — even a wildcard user cannot edit
    // another author's note (Decision 9). Only DELETE special-cases wildcard.
    if (existing.authorId !== req.user!.sub) {
      throw new HttpError(403, "not_note_author", "Only the author may edit this note");
    }

    const data: Prisma.CustomerNoteUpdateInput = {};
    if (body.body !== undefined) data.body = body.body;
    if (body.title !== undefined) data.title = body.title;

    const updated = await prisma.customerNote.update({
      where: { id: noteId },
      data,
      include: customerNoteInclude,
    });
    res.json(updated);
  },
);

customersRouter.delete(
  "/:id/notes/:noteId",
  requirePermission("project:write"),
  validate("params", customerNoteParamSchema),
  async (req, res) => {
    const { id, noteId } = req.params as unknown as z.infer<
      typeof customerNoteParamSchema
    >;
    await ensureCustomerVisible(req.user!, id);

    const existing = await prisma.customerNote.findUnique({ where: { id: noteId } });
    if (!existing || existing.customerId !== id) {
      throw new HttpError(404, "note_not_found", "Note not found");
    }
    if (existing.authorId !== req.user!.sub && !hasPermission(req.user!, "*")) {
      throw new HttpError(
        403,
        "not_note_author",
        "Only the author or a wildcard-permission user may delete this note",
      );
    }

    await prisma.customerNote.delete({ where: { id: noteId } });
    res.status(204).end();
  },
);

// ---- Weekly updates (per customer, Decision 2) ------------------------------
// The Mid-week highlight list (D4/D6 in docs/archive/plans/weekly-sync-highlight-rows.md)
// and the Reflection achievement list (D4/D6 in docs/archive/plans/weekly-sync-achievement-rows.md):
// each present on a save replaces its whole list, in array order, inside one
// transaction; omitted leaves it untouched; `[]` clears it. Every read of a
// WeeklyUpdate row includes both, each ordered by position.

const weeklyUpdateInclude = {
  author: { select: { id: true, username: true } },
  highlights: {
    orderBy: { position: "asc" as const },
    select: { id: true, position: true, title: true, detail: true, risk: true, action: true },
  },
  achievements: {
    orderBy: { position: "asc" as const },
    select: {
      id: true,
      position: true,
      title: true,
      detail: true,
      outstandingIssue: true,
      lessonLearned: true,
      nextWeekFocus: true,
      managerDecision: true,
    },
  },
} satisfies Prisma.WeeklyUpdateInclude;

customersRouter.get(
  "/:id/weekly-updates",
  requirePermission("project:read"),
  validate("params", idParamSchema),
  validate("query", weeklyUpdateListQuerySchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { limit } = req.query as unknown as z.infer<typeof weeklyUpdateListQuerySchema>;
    await ensureCustomerVisible(req.user!, id);

    const updates = await prisma.weeklyUpdate.findMany({
      where: { customerId: id },
      orderBy: { weekStart: "desc" },
      take: limit ?? 12,
      include: weeklyUpdateInclude,
    });
    res.json(updates);
  },
);

customersRouter.put(
  "/:id/weekly-updates/:weekStart",
  requirePermission("project:write"),
  validate("params", weeklyUpdateParamSchema),
  validate("body", saveWeeklyUpdateSchema),
  async (req, res) => {
    const { id, weekStart } = req.params as unknown as z.infer<
      typeof weeklyUpdateParamSchema
    >;
    const body = req.body as z.infer<typeof saveWeeklyUpdateSchema>;
    await ensureCustomerVisible(req.user!, id);

    // weekStart is already a valid day string (dayStringSchema, param
    // validation) — isMonday only needs to check the ISO weekday now.
    if (!isMonday(weekStart)) {
      throw new HttpError(
        400,
        "week_start_not_monday",
        "weekStart must be an ISO Monday (yyyy-MM-dd)",
      );
    }

    // Normalise every text field once. Each stays `undefined` when the key
    // was omitted (leave unchanged), or becomes the trimmed string / `null`
    // otherwise — see normalizeText.
    const category = normalizeText(body.category);

    const weekStartDate = utcMidnightOfDayString(weekStart);
    const existing = await prisma.weeklyUpdate.findUnique({
      where: { customerId_weekStart: { customerId: id, weekStart: weekStartDate } },
      select: {
        id: true,
        status: true,
        doneAt: true,
        health: true,
        _count: { select: { achievements: true } },
      },
    });

    // An omitted `status` leaves the stored status unchanged (DRAFT on
    // create) — a Mid-week-only save must never reopen (or otherwise
    // touch) a DONE row's status.
    const status = body.status ?? existing?.status ?? "DRAFT";

    // An omitted `health` leaves the stored value unchanged (explicit
    // `null` still clears it) — so the DONE completeness check looks at
    // the EFFECTIVE value: what the body sends, else what's already there.
    const effectiveHealth = body.health !== undefined ? body.health : (existing?.health ?? null);
    // Same effective-value pattern as health: the list the body sends when
    // present, else the count already stored (D7 in
    // docs/archive/plans/weekly-sync-achievement-rows.md).
    const effectiveAchievementCount =
      body.achievements !== undefined
        ? body.achievements.length
        : (existing?._count.achievements ?? 0);
    if (status === "DONE" && (effectiveHealth == null || effectiveAchievementCount === 0)) {
      throw new HttpError(
        400,
        "weekly_update_incomplete",
        "Marking a weekly update done requires health and at least one achievement",
      );
    }

    // doneAt is stamped once, on the transition INTO done — re-saving an
    // already-DONE row (e.g. a Mid-week-only edit) must not bump it. Any
    // non-DONE status always clears it.
    const doneAt =
      status === "DONE" ? (existing?.status === "DONE" ? existing.doneAt : new Date()) : null;

    // Stamped whenever the body touches any Mid-week field (category or
    // the highlight list) — even a field sent as `null`/`[]` counts, since
    // this marks "the Mid-week form was saved this week", not "it has
    // text".
    const midweekTouched = category !== undefined || body.highlights !== undefined;
    const highlights = body.highlights;
    const achievements = body.achievements;

    const result = await prisma.$transaction(async (tx) => {
      const upserted = await tx.weeklyUpdate.upsert({
        where: { customerId_weekStart: { customerId: id, weekStart: weekStartDate } },
        create: {
          customerId: id,
          weekStart: weekStartDate,
          authorId: req.user!.sub,
          health: body.health ?? null,
          status,
          doneAt,
          category: category ?? null,
          midweekSavedAt: midweekTouched ? new Date() : null,
        },
        update: {
          authorId: req.user!.sub,
          status,
          doneAt,
          ...(body.health !== undefined && { health: body.health }),
          ...(category !== undefined && { category }),
          ...(midweekTouched && { midweekSavedAt: new Date() }),
        },
      });

      if (highlights !== undefined) {
        await tx.weeklyHighlight.deleteMany({ where: { weeklyUpdateId: upserted.id } });
        if (highlights.length > 0) {
          await tx.weeklyHighlight.createMany({
            data: highlights.map((h, i) => ({
              weeklyUpdateId: upserted.id,
              position: i,
              title: h.title,
              detail: normalizeText(h.detail) ?? null,
              risk: normalizeText(h.risk) ?? null,
              action: normalizeText(h.action) ?? null,
            })),
          });
        }
      }

      if (achievements !== undefined) {
        await tx.weeklyAchievement.deleteMany({ where: { weeklyUpdateId: upserted.id } });
        if (achievements.length > 0) {
          await tx.weeklyAchievement.createMany({
            data: achievements.map((a, i) => ({
              weeklyUpdateId: upserted.id,
              position: i,
              title: a.title,
              detail: normalizeText(a.detail) ?? null,
              outstandingIssue: normalizeText(a.outstandingIssue) ?? null,
              lessonLearned: normalizeText(a.lessonLearned) ?? null,
              nextWeekFocus: normalizeText(a.nextWeekFocus) ?? null,
              managerDecision: normalizeText(a.managerDecision) ?? null,
            })),
          });
        }
      }

      return tx.weeklyUpdate.findUniqueOrThrow({
        where: { id: upserted.id },
        include: weeklyUpdateInclude,
      });
    });
    res.status(existing ? 200 : 201).json(result);
  },
);
