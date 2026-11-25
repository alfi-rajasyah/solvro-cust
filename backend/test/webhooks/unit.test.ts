import "../env.js";
import { describe, expect, it } from "vitest";
import { mapActivityToEvents } from "../../src/lib/webhooks/events.js";
import { WEBHOOK_EVENT_TYPES } from "../../src/lib/webhooks/eventTypes.js";
import { excerpt } from "../../src/lib/webhooks/payload.js";
import { generateSecret, signStandardWebhook } from "../../src/lib/webhooks/sign.js";
import { parseTarget, pinnedLookup, resolveTarget, urlPreview } from "../../src/lib/webhooks/validateTarget.js";

const row = (entityType: string, action: string, changes: unknown = null) => ({ entityType, action, changes });
const assignee = { from: null, to: { id: 4, username: "maya" } };

describe("mapActivityToEvents", () => {
  it("maps each allow-listed activity row", () => {
    expect(mapActivityToEvents(row("task", "created"))).toEqual(["task.created"]);
    expect(mapActivityToEvents(row("task", "created", { assignee }))).toEqual(["task.created", "task.assigned"]);
    expect(mapActivityToEvents(row("task", "updated", { status: { from: "To do", to: "In progress" } }))).toEqual(["task.status_changed"]);
    expect(mapActivityToEvents(row("task", "updated", { status: { from: "To do", to: "Done" } }), true)).toEqual([
      "task.status_changed",
      "task.completed",
    ]);
    expect(mapActivityToEvents(row("task", "updated", { assignee }))).toEqual(["task.assigned"]);
    expect(mapActivityToEvents(row("task", "updated", { dueDate: { from: null, to: "2026-12-01" } }))).toEqual(["task.due_date_changed"]);
    expect(mapActivityToEvents(row("task", "updated", { startDate: { from: null, to: "2026-12-01" } }))).toEqual(["task.due_date_changed"]);
    expect(mapActivityToEvents(row("comment", "created", { taskId: 1 }))).toEqual(["comment.created"]);
    expect(mapActivityToEvents(row("project", "created"))).toEqual(["project.created"]);
    expect(mapActivityToEvents(row("risk", "created"))).toEqual(["risk.created"]);
  });

  it("maps nothing for unassigning, other task edits, deletions, notes and everything else", () => {
    expect(mapActivityToEvents(row("task", "updated", { assignee: { from: { id: 4, username: "maya" }, to: null } }))).toEqual([]);
    expect(mapActivityToEvents(row("task", "updated", { title: { from: "a", to: "b" }, description: { changed: true } }))).toEqual([]);
    expect(mapActivityToEvents(row("task", "deleted"))).toEqual([]);
    expect(mapActivityToEvents(row("task", "updated", null))).toEqual([]);
    expect(mapActivityToEvents(row("project", "updated", { name: { from: "a", to: "b" } }))).toEqual([]);
    expect(mapActivityToEvents(row("risk", "updated", { status: { from: "OPEN", to: "CLOSED" } }))).toEqual([]);
    expect(mapActivityToEvents(row("comment", "deleted"))).toEqual([]);
  });

  it("never maps a note, whatever its action, and no event type mentions notes", () => {
    for (const action of ["created", "updated", "deleted", "added", "removed"]) {
      expect(mapActivityToEvents(row("note", action, { visibility: "CUSTOMER_FACING" }))).toEqual([]);
    }
    for (const entity of ["member", "epic", "share_link"]) {
      expect(mapActivityToEvents(row(entity, "created"))).toEqual([]);
    }
    expect(WEBHOOK_EVENT_TYPES.some((t) => t.includes("note"))).toBe(false);
  });
});

describe("signStandardWebhook", () => {
  it("matches the published Standard Webhooks / Svix example vector", () => {
    const signature = signStandardWebhook(
      ["whsec", "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"].join("_") /* the Standard Webhooks spec's public example secret, split so secret scanners do not flag it */,
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      1614265330,
      '{"test": 2432232314}',
    );
    expect(signature).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("generates whsec_ secrets of 24 random bytes", () => {
    const a = generateSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(generateSecret()).not.toBe(a);
  });
});

describe("payload helpers", () => {
  it("cuts a comment at 500 characters, not UTF-16 units", () => {
    expect(excerpt("a".repeat(600))).toHaveLength(500);
    expect(Array.from(excerpt("😀".repeat(600)))).toHaveLength(500);
    expect(excerpt("short")).toBe("short");
  });
});

describe("address policy", () => {
  const lookupTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  const refused = (p: Promise<unknown>, reason: string) =>
    expect(p).rejects.toMatchObject({ status: 400, code: "webhook_target_refused", reason });

  it("requires https unless http is allowed", async () => {
    await refused(resolveTarget("http://example.com/hook", { lookup: lookupTo("203.0.113.7") }), "scheme");
    await refused(resolveTarget("ftp://example.com/hook", { allowHttp: true, lookup: lookupTo("203.0.113.7") }), "scheme");
    await expect(resolveTarget("http://example.com/hook", { allowHttp: true, lookup: lookupTo("203.0.113.7") })).resolves.toMatchObject({
      address: "203.0.113.7",
    });
    await expect(resolveTarget("https://example.com/hook", { lookup: lookupTo("203.0.113.7") })).resolves.toMatchObject({ family: 4 });
  });

  it("refuses userinfo and unparsable URLs", () => {
    expect(() => parseTarget("https://user:pw@example.com/")).toThrowError(/user name or password/);
    expect(() => parseTarget("https://user@example.com/")).toThrowError(/user name or password/);
    expect(() => parseTarget("not a url")).toThrowError(/not valid/);
  });

  it("refuses private, loopback, link-local and IPv4-mapped addresses, by literal and by name", async () => {
    for (const host of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "[::1]", "[::ffff:10.0.0.1]", "[::ffff:7f00:1]", "[fd00::1]"]) {
      await refused(resolveTarget(`https://${host}/hook`), "private");
    }
    await refused(resolveTarget("https://localhost/hook"), "private");
    await refused(resolveTarget("https://intranet/hook"), "private");
    await refused(resolveTarget("https://app.internal/hook"), "private");
    await refused(resolveTarget("https://example.com/hook", { lookup: lookupTo("203.0.113.7", "10.0.0.5") }), "private");
    await refused(resolveTarget("https://example.com/hook", { lookup: lookupTo("::ffff:192.168.1.1") }), "private");
  });

  it("allows private addresses only when the flag says so", async () => {
    await expect(resolveTarget("https://127.0.0.1:8443/hook", { allowPrivate: true })).resolves.toMatchObject({ address: "127.0.0.1" });
    await expect(resolveTarget("https://localhost/hook", { allowPrivate: true, lookup: lookupTo("127.0.0.1") })).resolves.toMatchObject({
      address: "127.0.0.1",
    });
  });

  it("refuses a name that does not resolve", async () => {
    await refused(
      resolveTarget("https://nowhere.example/hook", {
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
      "unresolvable",
    );
  });

  it("pins the connection to the checked address for both lookup conventions", () => {
    const lookup = pinnedLookup("203.0.113.7", 4);
    lookup("evil.example", {}, (_e, address, family) => {
      expect(address).toBe("203.0.113.7");
      expect(family).toBe(4);
    });
    lookup("evil.example", { all: true }, (_e, address) => {
      expect(address).toEqual([{ address: "203.0.113.7", family: 4 }]);
    });
  });
});

describe("urlPreview", () => {
  it("keeps scheme, host and the first path segment, cuts later segments to 4 characters, hides the query", () => {
    expect(urlPreview("https://chat.example.com/v1/spaces/A/messages?key=k&token=t")).toBe("https://chat.example.com/v1/spac…/…/mess…?…");
    expect(urlPreview("https://hooks.example.com/inbound/team/123456/abcdef/")).toBe("https://hooks.example.com/inbound/…/1234…/abcd…/");
    expect(urlPreview("https://n8n.example.com/webhook/3f2b8c1e-9a47-4d0e-b6a1-5c7d2e8f9a10")).toBe("https://n8n.example.com/webhook/3f2b…");
    expect(urlPreview("https://hooks.example.com:8443/in")).toBe("https://hooks.example.com:8443/in");
    expect(urlPreview("https://hooks.example.com/in/abcd/abcde")).toBe("https://hooks.example.com/in/…/abcd…");
    expect(urlPreview("https://hooks.example.com")).toBe("https://hooks.example.com/");
    expect(urlPreview("https://hooks.example.com/in?x=1")).toBe("https://hooks.example.com/in?…");
  });

  it("never lets a path or query secret through", () => {
    const preview = urlPreview("https://hooks.example.com/services/T0001/B0002/SECRETSECRETSECRET?sig=SECRETQUERY");
    expect(preview).not.toMatch(/SECRETSECRET|SECRETQUERY|T0001|B0002/);
  });
});
