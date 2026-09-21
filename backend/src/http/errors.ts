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

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
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
