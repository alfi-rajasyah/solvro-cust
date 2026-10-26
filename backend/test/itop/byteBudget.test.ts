// The iTop client refuses a response body over its byte budget before it is
// JSON-parsed, so a huge or hostile upstream answer cannot exhaust memory.
import { describe, expect, it, vi } from "vitest";
import { createItopClient, ITOP_TRANSPORT_ERROR_CODES, ItopError } from "../../src/lib/itop/client.js";

const OK_BODY = JSON.stringify({ code: 0, message: "", version: "1.3", operations: [] });

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("iTop client response byte budget", () => {
  it("rejects a body streamed past the budget with a too_large ItopError, after one fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf(["x".repeat(600), "y".repeat(600)]), { status: 200 }));
    const client = createItopClient({
      baseUrl: "https://itop.example.com",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxResponseBytes: 1000,
    });
    await expect(client.listOperations()).rejects.toMatchObject({ name: "ItopError", code: "too_large" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects on a declared content-length over the budget without reading the body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(OK_BODY, { status: 200, headers: { "content-length": "5000000" } }),
    );
    const client = createItopClient({
      baseUrl: "https://itop.example.com",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxResponseBytes: 1000,
    });
    const err = await client.listOperations().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ItopError);
    expect((err as ItopError).code).toBe("too_large");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("still parses a normal body, including one split across chunks", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(streamOf([OK_BODY.slice(0, 10), OK_BODY.slice(10)]), { status: 200 }),
    );
    const client = createItopClient({
      baseUrl: "https://itop.example.com",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.listOperations()).resolves.toMatchObject({ code: 0, version: "1.3" });
  });
});

describe("too_large is a transport failure", () => {
  it("is in the shared transport-code set every iTop route maps to itop_unreachable", () => {
    // Without it, an oversized answer read as iTop refusing the action or the token.
    expect(ITOP_TRANSPORT_ERROR_CODES.has("too_large")).toBe(true);
  });
});
