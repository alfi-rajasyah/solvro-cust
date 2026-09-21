import type { RequestHandler } from "express";
import { ZodError, type ZodTypeAny } from "zod";

type Source = "body" | "query" | "params";

export function validate(source: Source, schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    try {
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
