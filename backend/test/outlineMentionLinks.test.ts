// Pure unit tests for Outline webhook link extraction and signature verification
// (docs/archive/plans/outline-integration.md, B5).
import "./env.js";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractSolvroLinks } from "../src/lib/outline/mentionLinks.js";
import {
  parseSignatureHeader,
  verifyOutlineSignature,
  WEBHOOK_TOLERANCE_MS,
} from "../src/lib/outline/webhookSignature.js";
import { toRelativeDocPath } from "../src/lib/outline/mentions.js";

const APP = "https://solvro.acme.com";
const links = (md: string) => extractSolvroLinks(md, APP);

describe("extractSolvroLinks", () => {
  it("finds a project link (with and without a tab)", () => {
    expect(links(`See ${APP}/projects/12 and ${APP}/projects/13/timeline`).projectIds).toEqual([12, 13]);
  });

  it("finds a task link as task-level only", () => {
    const r = links(`${APP}/projects/12?task=34`);
    expect(r.projectIds).toEqual([]);
    expect(r.tasks).toEqual([{ projectId: 12, taskId: 34 }]);
  });

  it("handles a tab plus ?task= and extra query params / hash", () => {
    expect(links(`${APP}/projects/12/list?foo=bar&task=34#x`).tasks).toEqual([{ projectId: 12, taskId: 34 }]);
  });

  it("handles markdown links, autolinks, bare URLs and links with titles", () => {
    const md = [
      `[the project](${APP}/projects/1)`,
      `<${APP}/projects/2>`,
      `bare ${APP}/projects/3 here`,
      `[titled](${APP}/projects/4 "My title")`,
      `[task](${APP}/projects/5?task=6)`,
    ].join("\n");
    const r = links(md);
    expect(r.projectIds).toEqual([1, 2, 3, 4]);
    expect(r.tasks).toEqual([{ projectId: 5, taskId: 6 }]);
  });

  it("strips trailing punctuation and markdown emphasis", () => {
    const r = links(`Done: ${APP}/projects/7. Also (${APP}/projects/8), ${APP}/projects/9; **${APP}/projects/10**, ${APP}/projects/11?`);
    expect(r.projectIds).toEqual([7, 8, 9, 10, 11]);
  });

  it("handles URL-encoded variants and HTML-escaped ampersands", () => {
    expect(links(`${APP}/projects/%31%32`).projectIds).toEqual([12]);
    expect(links(`${APP}/projects/12?x=1&amp;task=34`).tasks).toEqual([{ projectId: 12, taskId: 34 }]);
    expect(links(`${APP}/projects/12?task=%33%34`).tasks).toEqual([{ projectId: 12, taskId: 34 }]);
  });

  it("matches the origin case-insensitively and ignores a default port", () => {
    expect(links("HTTPS://SOLVRO.ACME.COM/projects/5").projectIds).toEqual([5]);
    expect(links("https://solvro.acme.com:443/projects/5").projectIds).toEqual([5]);
  });

  it("dedupes repeated links", () => {
    const r = links(`${APP}/projects/1 ${APP}/projects/1/list [x](${APP}/projects/2?task=3) ${APP}/projects/2?task=3`);
    expect(r.projectIds).toEqual([1]);
    expect(r.tasks).toEqual([{ projectId: 2, taskId: 3 }]);
  });

  it("ignores other origins, lookalike hosts, other ports and schemes", () => {
    const md = [
      "https://other.example.com/projects/1",
      "https://solvro.acme.com.evil.test/projects/2",
      "https://evil.test/https://solvro.acme.com/projects/3",
      "http://solvro.acme.com/projects/4",
      "https://solvro.acme.com:8443/projects/5",
      "javascript:alert(1)//solvro.acme.com/projects/6",
      "ftp://solvro.acme.com/projects/7",
      "/projects/8",
    ].join("\n");
    const r = links(md);
    expect(r).toEqual({ projectIds: [], tasks: [] });
  });

  it("ignores malformed ids, other paths, deeper paths and a malformed ?task=", () => {
    const md = [
      `${APP}/projects/abc`,
      `${APP}/projects/0`,
      `${APP}/projects/-1`,
      `${APP}/projects/1.5`,
      `${APP}/projects/99999999999`,
      `${APP}/projects/`,
      `${APP}/projects`,
      `${APP}/customers/3`,
      `${APP}/projects/3/list/extra`,
      `${APP}/projects/3/..%2Fadmin`,
      `${APP}/projects/4?task=abc`,
      `${APP}/projects/4?task=0`,
      `${APP}/projects/4?task=`,
      `${APP}/tasks?task=5`,
      `${APP}/projects/%ZZ`,
      `${APP}/embed/projects/6/tasks`,
    ].join("\n");
    const r = links(md);
    expect(r).toEqual({ projectIds: [], tasks: [] });
  });

  it("returns nothing for text without links", () => {
    expect(links("")).toEqual({ projectIds: [], tasks: [] });
    expect(links("just words /projects/1 and solvro.acme.com/projects/2")).toEqual({ projectIds: [], tasks: [] });
  });
});

describe("toRelativeDocPath", () => {
  it("keeps a relative path and reduces an absolute URL to its path", () => {
    expect(toRelativeDocPath("/doc/plan-AbC123", "x")).toBe("/doc/plan-AbC123");
    expect(toRelativeDocPath("https://docs.acme.com/doc/plan-AbC123?a=1", "x")).toBe("/doc/plan-AbC123?a=1");
  });
  it("falls back to /doc/<id> for anything unusable", () => {
    for (const bad of [undefined, null, "", "//evil.test/x", "javascript:alert(1)", "doc/x"]) {
      expect(toRelativeDocPath(bad, "uuid-1")).toBe("/doc/uuid-1");
    }
  });
});

function sign(secret: string, t: number | string, body: string): string {
  return `t=${t},s=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

describe("verifyOutlineSignature", () => {
  const secret = "whsec-test";
  const body = Buffer.from('{"event":"documents.update"}');
  const now = 1_800_000_000_000;

  it("accepts a valid signature with a millisecond timestamp", () => {
    expect(verifyOutlineSignature(sign(secret, now, body.toString()), body, secret, now)).toBe("ok");
    expect(verifyOutlineSignature(sign(secret, now - WEBHOOK_TOLERANCE_MS, body.toString()), body, secret, now)).toBe("ok");
    expect(verifyOutlineSignature(sign(secret, now + WEBHOOK_TOLERANCE_MS, body.toString()), body, secret, now)).toBe("ok");
  });

  it("rejects a stale timestamp in either direction (t is milliseconds)", () => {
    expect(verifyOutlineSignature(sign(secret, now - WEBHOOK_TOLERANCE_MS - 1, body.toString()), body, secret, now)).toBe("stale");
    expect(verifyOutlineSignature(sign(secret, now + WEBHOOK_TOLERANCE_MS + 1, body.toString()), body, secret, now)).toBe("stale");
    // A seconds-resolution timestamp is ~1970 when read as milliseconds.
    expect(verifyOutlineSignature(sign(secret, Math.floor(now / 1000), body.toString()), body, secret, now)).toBe("stale");
  });

  it("rejects a wrong secret, a tampered body and a tampered timestamp", () => {
    expect(verifyOutlineSignature(sign("other", now, body.toString()), body, secret, now)).toBe("mismatch");
    expect(verifyOutlineSignature(sign(secret, now, body.toString()), Buffer.from('{"event":"x"}'), secret, now)).toBe("mismatch");
    const good = sign(secret, now, body.toString());
    expect(verifyOutlineSignature(good.replace(`t=${now}`, `t=${now + 1}`), body, secret, now)).toBe("mismatch");
  });

  it("rejects malformed headers", () => {
    for (const bad of ["", "garbage", "t=1", "s=abc", `t=${now},s=zz`, `t=abc,s=${"0".repeat(64)}`, `t=${now},s=${"0".repeat(63)}`]) {
      expect(verifyOutlineSignature(bad, body, secret, now), bad).toBe("malformed");
    }
  });

  it("parses the header regardless of key order and spacing", () => {
    const s = "a".repeat(64);
    expect(parseSignatureHeader(`s=${s}, t=123`)?.t).toBe("123");
  });
});
