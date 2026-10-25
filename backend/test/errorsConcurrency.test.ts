// The error handler's safety net for transactions Postgres aborted because a
// concurrent one touched the same rows (http/errors.ts): a deadlock or a
// serialisation failure is a retryable 409, never a 500.
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { errorHandler } from "../src/http/errors.js";

function run(err: unknown) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  errorHandler(err, {} as Request, res as unknown as Response, (() => {}) as NextFunction);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

describe("errorHandler: concurrent transaction aborts", () => {
  it("answers 409 concurrent_update for a deadlock inside an interactive transaction", () => {
    const err = new Prisma.PrismaClientUnknownRequestError(
      'Error occurred during query execution: PostgresError { code: "40P01", message: "deadlock detected" }',
      { clientVersion: "5.22.0" },
    );
    expect(run(err)).toEqual({
      status: 409,
      body: { error: "Another change was saved at the same moment. Try again.", code: "concurrent_update" },
    });
  });

  it("answers 409 for a serialisation failure (P2034 and 40001)", () => {
    const known = new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "5.22.0" });
    expect(run(known).status).toBe(409);
    const unknown = new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "40001" }', {
      clientVersion: "5.22.0",
    });
    expect(run(unknown).status).toBe(409);
  });

  it("answers 409 for a deadlock or a lock wait on a raw statement (P2010)", () => {
    for (const code of ["40P01", "55P03"]) {
      const err = new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${code}\``, {
        code: "P2010",
        clientVersion: "5.22.0",
        meta: { code, message: "..." },
      });
      expect(run(err).status).toBe(409);
    }
  });

  it("reads only the error's code: row data that contains 40001 stays a 500", () => {
    // A CHECK violation whose detail echoes a row value with "40001" in it.
    const err = new Prisma.PrismaClientUnknownRequestError(
      'PostgresError { code: "23514", message: "new row violates check constraint", detail: Some("Failing row contains (40001, 40P01).") }',
      { clientVersion: "5.22.0" },
    );
    expect(run(err).status).toBe(500);
  });

  it("keeps any other unknown database error a 500", () => {
    const err = new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "XX000" }', { clientVersion: "5.22.0" });
    expect(run(err).status).toBe(500);
  });
});
