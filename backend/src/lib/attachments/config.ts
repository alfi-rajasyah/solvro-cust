import { z } from "zod";

// Env surface for task attachments (docs/archive/plans/task-attachments.md).
// Lives here so tests can parse it without importing env.ts, which exits the
// process on failure.

export const DEFAULT_ALLOWED_EXTENSIONS =
  "png,jpg,jpeg,gif,webp,pdf,docx,xlsx,pptx,txt,csv,log,md,json,yaml,yml,zip";

// A blank or whitespace-only value counts as unset, so `.default()` applies.
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const boolish = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
  .transform((value) => value === "true" || value === "1" || value === "yes");

// An env value that is set but empty (`S3_BUCKET=`) counts as unset.
const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

export const attachmentEnvShape = {
  ATTACHMENTS_DRIVER: z.preprocess(blankToUndefined, z.enum(["local", "s3"]).default("local")),
  ATTACHMENTS_DIR: z.preprocess(blankToUndefined, z.string().min(1).default("/app/uploads")),
  ATTACHMENT_MAX_FILE_MB: z.preprocess(blankToUndefined, z.coerce.number().positive().default(25)),
  ATTACHMENT_MAX_FILES_PER_TASK: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().default(20),
  ),
  ATTACHMENT_MAX_TASK_MB: z.preprocess(blankToUndefined, z.coerce.number().positive().default(100)),
  ATTACHMENT_ALLOWED_EXTENSIONS: z.preprocess(
    blankToUndefined,
    z
      .string()
      .default(DEFAULT_ALLOWED_EXTENSIONS)
      .transform((value) => [
        ...new Set(
          value
            .split(",")
            .map((part) => part.trim().toLowerCase().replace(/^\./, ""))
            .filter((part) => part.length > 0),
        ),
      ])
      .refine((list) => list.length > 0, {
        message: "ATTACHMENT_ALLOWED_EXTENSIONS must list at least one extension",
      }),
  ),
  S3_ENDPOINT: optionalText,
  S3_REGION: optionalText,
  S3_BUCKET: optionalText,
  S3_ACCESS_KEY_ID: optionalText,
  S3_SECRET_ACCESS_KEY: optionalText,
  // Optional namespace so separate deployments can share one bucket.
  S3_KEY_PREFIX: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
      return trimmed ? `${trimmed}/` : undefined;
    }),
  S3_FORCE_PATH_STYLE: z.preprocess(blankToUndefined, boolish.default("false")),
};

const S3_REQUIRED = [
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

/** Refuses to start when the driver is `s3` and an `S3_*` value is missing. */
export function checkAttachmentConfig(
  value: { ATTACHMENTS_DRIVER: "local" | "s3" } & Partial<Record<(typeof S3_REQUIRED)[number], string>>,
  ctx: z.RefinementCtx,
): void {
  if (value.ATTACHMENTS_DRIVER !== "s3") return;
  for (const key of S3_REQUIRED) {
    if (!value[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when ATTACHMENTS_DRIVER=s3`,
      });
    }
  }
}

export interface AttachmentConfig {
  ATTACHMENTS_DRIVER: "local" | "s3";
  ATTACHMENTS_DIR: string;
  ATTACHMENT_MAX_FILE_MB: number;
  ATTACHMENT_MAX_FILES_PER_TASK: number;
  ATTACHMENT_MAX_TASK_MB: number;
  ATTACHMENT_ALLOWED_EXTENSIONS: string[];
  S3_ENDPOINT?: string | undefined;
  S3_REGION?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_KEY_PREFIX?: string | undefined;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  S3_FORCE_PATH_STYLE: boolean;
}

/** Parse a raw env-like object (used by tests; env.ts embeds the same shape). */
export function parseAttachmentConfig(raw: Record<string, string | undefined>) {
  return z
    .object(attachmentEnvShape)
    .superRefine((value, ctx) => checkAttachmentConfig(value, ctx))
    .safeParse(raw);
}
