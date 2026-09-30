// TRUST_PROXY parsing (http/trustProxy.ts, wired in src/env.ts + src/app.ts).
import "./env.js";
import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { parseTrustProxy } from "../src/http/trustProxy.js";

describe("parseTrustProxy", () => {
  it("accepts hop counts", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy(" 2 ")).toBe(2);
    expect(parseTrustProxy("0")).toBe(0);
    expect(parseTrustProxy("10")).toBe(10);
  });

  it("accepts Express trust names and address/subnet lists", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("loopback, uniquelocal")).toBe("loopback, uniquelocal");
    expect(parseTrustProxy("Loopback,10.0.0.0/8")).toBe("loopback, 10.0.0.0/8");
    expect(parseTrustProxy("172.18.0.2")).toBe("172.18.0.2");
    expect(parseTrustProxy("fc00::/7, ::1")).toBe("fc00::/7, ::1");
  });

  it("rejects everything else, including 'true' (trust every hop)", () => {
    for (const bad of ["", "  ", "true", "false", "11", "-1", "1.5", "nginx", "loopback,,", "loopback; drop", "10.0.0.0/8 extra", "999.1.1.1", "10.0.0.0/99"]) {
      expect(parseTrustProxy(bad), bad).toBeNull();
    }
  });

  it("the parsed values are accepted by Express and change what req.ip reads", async () => {
    const ipFor = async (setting: number | string) => {
      const app = express();
      app.set("trust proxy", setting);
      app.get("/", (req, res) => {
        res.json({ ip: req.ip });
      });
      const res = await request(app).get("/").set("X-Forwarded-For", "198.51.100.9, 203.0.113.5");
      return (res.body as { ip: string }).ip;
    };
    expect(await ipFor(parseTrustProxy("1")!)).toBe("203.0.113.5"); // nginx only
    expect(await ipFor(parseTrustProxy("2")!)).toBe("198.51.100.9"); // tunnel + nginx
    expect(await ipFor(parseTrustProxy("loopback")!)).toBe("203.0.113.5"); // supertest connects from loopback
  });
});
