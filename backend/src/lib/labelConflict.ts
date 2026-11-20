import { Prisma } from "@prisma/client";
import { HttpError } from "../http/errors.js";

export const LABEL_EXISTS_MESSAGE = "A label with that name already exists";

/** True for the unique violation on a label's (project, name) index. */
export function isLabelNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const meta = err.meta as { target?: unknown; constraint?: unknown } | undefined;
  const parts = [meta?.target, meta?.constraint].flat().filter((v): v is string => typeof v === "string");
  return parts.some((v) => v.includes("name"));
}

export function labelExistsError(): HttpError {
  return new HttpError(409, "label_exists", LABEL_EXISTS_MESSAGE);
}
