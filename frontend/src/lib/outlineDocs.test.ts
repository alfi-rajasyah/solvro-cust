import { afterEach, describe, expect, it } from "vitest";
import {
  defaultDocTitle,
  defaultPlaceValue,
  flattenDocs,
  outlineReturnNotice,
  placeUnderOptions,
  retryAfterText,
  stripOutlineReturnParams,
  webhookHealth,
} from "./outlineDocs";
import type { OutlineDocNode } from "./queries";

const node = (id: string, title: string, children: OutlineDocNode[] = []): OutlineDocNode => ({
  id,
  title,
  url: `https://docs.example.com/doc/${id}`,
  children,
});

describe("outlineReturnNotice", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("has no notice without the parameter", () => {
    expect(outlineReturnNotice(q(""))).toBeNull();
    expect(outlineReturnNotice(q("tab=x"))).toBeNull();
    expect(outlineReturnNotice(q("outline=whatever"))).toBeNull();
  });
  it("maps connected and cancelled", () => {
    expect(outlineReturnNotice(q("outline=connected"))).toEqual({ tone: "success", message: "Outline connected." });
    expect(outlineReturnNotice(q("outline=cancelled"))?.tone).toBe("info");
  });
  it("gives human copy for every error reason, and a generic one otherwise", () => {
    const msg = (reason: string) => outlineReturnNotice(q(`outline=error&reason=${reason}`))!.message;
    expect(msg("identity_mismatch")).toContain("uses a different email than your Solvro account");
    expect(msg("already_linked")).toContain("already connected to another Solvro user");
    expect(msg("state")).toContain("expired");
    expect(msg("exchange")).toContain("did not accept");
    expect(msg("unavailable")).toContain("could not reach Outline");
    expect(msg("not_configured")).toContain("administrator");
    expect(msg("nonsense")).toBe("Could not connect Outline. Try again.");
    expect(outlineReturnNotice(q("outline=error"))!.tone).toBe("error");
    // The reason text is never echoed into the copy.
    expect(msg("<script>")).not.toContain("script");
  });
  it("strips only the return parameters", () => {
    expect(stripOutlineReturnParams(q("outline=error&reason=state&tab=x")).toString()).toBe("tab=x");
  });
});

describe("placeUnderOptions", () => {
  const tree = [
    node("a", "Core Banking Migration", [node("b", "Meeting notes", [node("c", "Weekly")]), node("d", "Runbook")]),
    node("e", "Standalone"),
  ];
  it("lists a collection's top level, then every page with its path", () => {
    const opts = placeUnderOptions({ kind: "collection", title: "Northwind" }, tree);
    expect(opts.map((o) => o.label)).toEqual([
      "Northwind (top level)",
      "Northwind › Core Banking Migration",
      "Northwind › Core Banking Migration › Meeting notes",
      "Northwind › Core Banking Migration › Meeting notes › Weekly",
      "Northwind › Core Banking Migration › Runbook",
      "Northwind › Standalone",
    ]);
    expect(opts[0].value).toBe("");
    expect(opts[1].value).toBe("a");
    expect(defaultPlaceValue({ kind: "collection" }, tree)).toBe("");
  });
  it("starts a page anchor at the anchor itself and defaults to it", () => {
    const docTree = [node("root", "Core Banking Migration", [node("x", "Cut-over")])];
    const opts = placeUnderOptions({ kind: "doc", title: "Core Banking Migration" }, docTree);
    expect(opts.map((o) => [o.value, o.label])).toEqual([
      ["root", "Core Banking Migration"],
      ["x", "Core Banking Migration › Cut-over"],
    ]);
    expect(defaultPlaceValue({ kind: "doc" }, docTree)).toBe("root");
  });
  it("flattens parents first", () => {
    expect(flattenDocs(tree).map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("defaultDocTitle", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  it("is '<template> — <date>' and falls back for a blank page", () => {
    expect(defaultDocTitle("Meeting notes", now)).toBe("Meeting notes — 9 Oct");
    expect(defaultDocTitle(null, now)).toBe("New page — 9 Oct");
    expect(defaultDocTitle("  ", now)).toBe("New page — 9 Oct");
  });
  describe("uses the local day, not the UTC day", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });
    it("early morning in UTC+7 is still that local day", () => {
      process.env.TZ = "Asia/Bangkok";
      // 02:00 local on 9 Oct is 19:00Z on 8 Oct.
      const early = new Date("2026-10-08T19:00:00Z");
      expect(defaultDocTitle("Meeting notes", early)).toBe("Meeting notes — 9 Oct");
    });
    it("late evening in UTC-8 is still that local day", () => {
      process.env.TZ = "America/Los_Angeles";
      // 21:00 local on 9 Oct is 04:00Z on 10 Oct.
      const late = new Date("2026-10-10T04:00:00Z");
      expect(defaultDocTitle(null, late)).toBe("New page — 9 Oct");
    });
    it("a local-time date is its own day in any zone", () => {
      expect(defaultDocTitle(null, new Date(2026, 9, 9, 2, 0))).toBe("New page — 9 Oct");
    });
  });
  it("never exceeds the 255-character limit", () => {
    expect(defaultDocTitle("x".repeat(400), now).length).toBeLessThanOrEqual(255);
  });
});

describe("retryAfterText", () => {
  it("reads seconds, minutes and a missing hint", () => {
    expect(retryAfterText(12)).toBe("Try again in 12 s.");
    expect(retryAfterText(180)).toBe("Try again in 3 min.");
    expect(retryAfterText(null)).toBe("Try again in a moment.");
    expect(retryAfterText(0)).toBe("Try again in a moment.");
  });
});

describe("webhookHealth", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("is never, stale after 24 h, ok within", () => {
    expect(webhookHealth(null, now)).toBe("never");
    expect(webhookHealth("garbage", now)).toBe("never");
    expect(webhookHealth("2026-10-09T11:00:00Z", now)).toBe("ok");
    expect(webhookHealth("2026-10-08T12:00:01Z", now)).toBe("ok");
    expect(webhookHealth("2026-10-08T11:59:59Z", now)).toBe("stale");
  });
});
