// CORS exposes X-Total-Count so a cross-origin caller can read GET /tasks paging totals.
import "./env.js";
import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";

describe("CORS exposed headers", () => {
  it("lists X-Total-Count in Access-Control-Expose-Headers", async () => {
    const res = await request(createApp()).get("/health").set("Origin", "https://other.example");
    expect(res.headers["access-control-expose-headers"]).toMatch(/x-total-count/i);
  });
});
