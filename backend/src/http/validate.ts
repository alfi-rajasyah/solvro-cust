import type { RequestHandler } from "express";
import { ZodError, type ZodTypeAny } from "zod";
import { HttpError } from "./errors.js";

type Source = "body" | "query" | "params";

/**
 * Postgres text columns cannot hold U+0000 (error 22021 at the write, which
 * used to surface as a 500). Every validated body/query/params value is
 * scanned first, so no route has to opt in; http/errors.ts maps a 22021 that
 * still gets through (an unvalidated route) to the same 400.
 */
function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (depth > 32 || typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  return Object.entries(value).some(([k, v]) => containsNul(k, depth + 1) || containsNul(v, depth + 1));
}

export function validate(source: Source, schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    try {
      if (containsNul(req[source])) {
        throw new HttpError(400, "validation_error", "Text must not contain NUL characters");
      }
      const parsed = schema.parse(req[source]);
      // Re-assigning preserves type narrowing for downstream handlers.
      (req as unknown as Record<Source, unknown>)[source] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) return next(err);
      next(err);
    }
  };
}
