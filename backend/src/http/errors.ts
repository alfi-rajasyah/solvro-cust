import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "Not found", code: "not_found", path: req.originalUrl });
};

// body-parser (express.json) errors are http-errors with a string `type`
// ("entity.parse.failed", "entity.too.large", "encoding.unsupported", …) and
// carry the offending request text in `err.body`. That text can hold secrets
// (settings PATCH bodies, personal tokens), and these errors fire before auth,
// so they are answered here as a client error and NEVER logged.
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  if (typeof err !== "object" || err === null) return false;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return (
    typeof type === "string" &&
    /^(entity|encoding|charset|request|stream|parameters)\./.test(type) &&
    typeof status === "number"
  );
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (isBodyParserError(err)) {
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON", code: "invalid_json" });
    } else if (err.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large", code: "payload_too_large" });
    } else {
      const status = err.status >= 400 && err.status < 500 ? err.status : 400;
      res.status(status).json({ error: "Request body could not be read", code: "invalid_request" });
    }
    return;
  }

  if (err instanceof HttpError) {
    res
      .status(err.status)
      .json({ error: err.message, code: err.code, details: err.details });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      code: "validation_error",
      details: err.flatten(),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Record not found", code: "not_found" });
      return;
    }
    // A foreign-key violation: an id in the body that names no row, or (rarer)
    // a delete that races past its own "still referenced" check. Routes check
    // their body ids first; this is the safety net so a missed one is a 400,
    // not a 500. No `meta`: it names the constraint.
    if (err.code === "P2003") {
      res.status(400).json({ error: "Invalid reference to a related record", code: "invalid_reference" });
      return;
    }
    // No `meta` here either: it names the columns, and for a name another
    // user's hidden record already holds that confirms the record exists.
    if (err.code === "P2002") {
      res.status(409).json({
        error: "Unique constraint violated",
        code: "conflict",
      });
      return;
    }
  }

  // Postgres aborted the statement because another transaction held or
  // changed the same rows: a deadlock (40P01), a serialisation failure
  // (40001, Prisma P2034) or a lock wait past `lock_timeout` (55P03, e.g.
  // lib/orderLock.ts). Nothing was saved, and the same request succeeds when
  // sent again, so it is a 409 the client can retry, not a 500. Routes that
  // re-pack shared rows serialise themselves (lib/orderLock.ts); a deadlock
  // that still reaches this point is logged, so a remaining lock cycle shows.
  const pgCode = postgresCode(err);
  if (pgCode !== undefined && CONCURRENCY_ABORT_CODES.has(pgCode)) {
    logger.warn({ err, pgCode }, "transaction aborted by a concurrent one");
    res.status(409).json({
      error: "Another change was saved at the same moment. Try again.",
      code: "concurrent_update",
    });
    return;
  }

  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error", code: "internal_error" });
};

const CONCURRENCY_ABORT_CODES = new Set(["40P01", "40001", "55P03"]);

/**
 * The Postgres SQLSTATE behind a Prisma error, when Prisma reports one: the
 * `meta.code` of a failed raw statement (P2010), 40001 for P2034, or the
 * `code` field of the PostgresError an interactive transaction reports as an
 * unknown request error. Only that field is read, never the rest of the
 * message, which carries row data.
 */
function postgresCode(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") return "40001";
    if (err.code !== "P2010") return undefined;
    const code = (err.meta as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? code : undefined;
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return /PostgresError \{ code: "([0-9A-Z]{5})"/.exec(err.message)?.[1];
  }
  return undefined;
}
