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
    if (err.code === "P2002") {
      res.status(409).json({
        error: "Unique constraint violated",
        code: "conflict",
        details: err.meta,
      });
      return;
    }
  }

  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error", code: "internal_error" });
};
