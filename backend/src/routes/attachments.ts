import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { requireAuth, requirePermission } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { ensureTaskVisible } from "../lib/visibility.js";
import { getStorage, StorageNotFoundError } from "../lib/attachments/storage.js";
import {
  cleanFileName,
  isAllowedExtension,
  mimeTypeFor,
  storageKeyFor,
} from "../lib/attachments/limits.js";

const MB = 1024 * 1024;

function limits() {
  return {
    maxFileBytes: Math.floor(env.ATTACHMENT_MAX_FILE_MB * MB),
    maxFilesPerTask: env.ATTACHMENT_MAX_FILES_PER_TASK,
    maxTaskBytes: Math.floor(env.ATTACHMENT_MAX_TASK_MB * MB),
    allowedExtensions: env.ATTACHMENT_ALLOWED_EXTENSIONS,
  };
}

function formatMb(bytes: number): string {
  const mb = bytes / MB;
  return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(2))} MB`;
}

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { id: true, username: true } },
} as const;

type AttachmentRow = {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedBy: { id: number; username: string } | null;
};

function present(row: AttachmentRow) {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    uploadedBy: row.uploadedBy ? { id: row.uploadedBy.id, name: row.uploadedBy.username } : null,
  };
}

const uploadParser = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  // Names without an explicit charset are UTF-8, as browsers send them.
  defParamCharset: "utf8",
  limits: { fileSize: limits().maxFileBytes, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedExtension(file.originalname, env.ATTACHMENT_ALLOWED_EXTENSIONS)) {
      cb(
        new HttpError(
          415,
          "attachment_type_not_allowed",
          `This file type is not allowed. Allowed types: ${env.ATTACHMENT_ALLOWED_EXTENSIONS.join(", ")}.`,
        ),
      );
      return;
    }
    cb(null, true);
  },
}).single("file");

const parseUpload: RequestHandler = (req, res, next) => {
  uploadParser(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new HttpError(
            413,
            "attachment_too_large",
            `Files can be up to ${formatMb(limits().maxFileBytes)}.`,
          ),
        );
      }
      return next(
        new HttpError(400, "attachment_invalid_upload", "Send one file in the \"file\" field."),
      );
    }
    next(err);
  });
};

async function assertWithinTaskLimits(
  db: Pick<typeof prisma, "taskAttachment">,
  taskId: number,
  incomingBytes: number,
): Promise<void> {
  const { maxFilesPerTask, maxTaskBytes } = limits();
  const agg = await db.taskAttachment.aggregate({
    where: { taskId },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
  if (agg._count._all >= maxFilesPerTask) {
    throw new HttpError(
      409,
      "attachment_count_limit",
      `A task can have up to ${maxFilesPerTask} files.`,
    );
  }
  if ((agg._sum.sizeBytes ?? 0) + incomingBytes > maxTaskBytes) {
    throw new HttpError(
      409,
      "attachment_total_limit",
      `A task's files can total up to ${formatMb(maxTaskBytes)}.`,
    );
  }
}

// List and upload live under /tasks/:id/attachments. They sit in their own
// router, mounted on "/tasks" after tasksRouter (as taskOutlineMentionsRouter
// is), so routes/tasks.ts stays untouched by them.
export const taskAttachmentsRouter = Router();
taskAttachmentsRouter.use(requireAuth, requirePermission("project:read"));

taskAttachmentsRouter.get(
  "/:id/attachments",
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);
    const rows = await prisma.taskAttachment.findMany({
      where: { taskId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: attachmentSelect,
    });
    res.json(rows.map(present));
  },
);

taskAttachmentsRouter.post(
  "/:id/attachments",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  // Visibility is settled before multer reads a byte of the body.
  async (req, _res, next) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    await ensureTaskVisible(req.user!, id);
    next();
  },
  parseUpload,
  async (req: Request, res: Response) => {
    const { id: taskId } = req.params as unknown as z.infer<typeof idParamSchema>;
    const file = req.file;
    if (!file) {
      throw new HttpError(400, "attachment_missing", "Choose a file to attach.");
    }
    const key = storageKeyFor(taskId);
    let stored = false;
    try {
      const fileName = cleanFileName(file.originalname);
      // A cheap early refusal, before the bytes are sent to the store.
      await assertWithinTaskLimits(prisma, taskId, file.size);

      await getStorage().put(
        key,
        createReadStream(file.path),
        file.size,
        mimeTypeFor(fileName),
      );
      stored = true;

      // The decisive check: under a task row lock, so two concurrent uploads
      // cannot both slip past the count or total-size limit.
      const row = await prisma.$transaction(async (tx) => {
        // FOR NO KEY UPDATE: serialises uploads (and a task or project delete,
        // which locks the same row) without blocking FK-check inserts.
        const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM tasks WHERE id = ${taskId} FOR NO KEY UPDATE`;
        // The task was deleted while the file was being stored.
        if (locked.length === 0) throw new HttpError(404, "not_found", "Task not found");
        await assertWithinTaskLimits(tx, taskId, file.size);
        return tx.taskAttachment.create({
          data: {
            taskId,
            fileName,
            mimeType: mimeTypeFor(fileName),
            sizeBytes: file.size,
            storageKey: key,
            uploadedById: req.user!.sub,
          },
          select: attachmentSelect,
        });
      });
      stored = false;
      res.status(201).json(present(row));
    } catch (err) {
      if (stored) {
        await getStorage()
          .delete(key)
          .catch((deleteErr: unknown) =>
            logger.warn(
              { err: deleteErr instanceof Error ? deleteErr.message : String(deleteErr), key },
              "Could not remove a stored attachment after a failed upload",
            ),
          );
      }
      throw err;
    } finally {
      await rm(file.path, { force: true });
    }
  },
);

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth, requirePermission("project:read"));

// Registered before "/:id" so "config" is never read as an id.
attachmentsRouter.get("/config", (_req, res) => {
  res.json(limits());
});

async function loadVisibleAttachment(req: Request, id: number) {
  const row = await prisma.taskAttachment.findUnique({
    where: { id },
    select: { ...attachmentSelect, taskId: true, storageKey: true },
  });
  if (!row) throw new HttpError(404, "not_found", "Attachment not found");
  // 404, not 403: a hidden task and a missing attachment answer alike.
  try {
    await ensureTaskVisible(req.user!, row.taskId);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError(404, "not_found", "Attachment not found");
    }
    throw err;
  }
  return row;
}

attachmentsRouter.get("/:id", validate("params", idParamSchema), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
  const row = await loadVisibleAttachment(req, id);

  let object;
  try {
    object = await getStorage().get(row.storageKey);
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      throw new HttpError(404, "not_found", "Attachment not found");
    }
    throw err;
  }

  // res.attachment encodes the name (RFC 5987) and sets a type from the
  // extension; the stored type, set from the extension at upload, replaces it.
  res.attachment(row.fileName);
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(object.size ?? row.sizeBytes));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");

  res.on("close", () => {
    if (!res.writableFinished) object.stream.destroy();
  });
  try {
    await pipeline(object.stream, res);
  } catch (err) {
    // A client that hung up mid-download is not an error worth a log line.
    if (!res.writableFinished && (err as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), attachmentId: id },
        "Attachment download stream failed",
      );
    }
    res.destroy();
  }
});

attachmentsRouter.delete(
  "/:id",
  requirePermission("task:write"),
  validate("params", idParamSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const row = await loadVisibleAttachment(req, id);
    await prisma.taskAttachment.deleteMany({ where: { id } });
    await getStorage()
      .delete(row.storageKey)
      .catch((err: unknown) =>
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), key: row.storageKey },
          "Could not delete a stored attachment",
        ),
      );
    res.status(204).end();
  },
);
