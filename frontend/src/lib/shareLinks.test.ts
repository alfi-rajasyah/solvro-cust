import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  absoluteShareUrl,
  guestErrorCopy,
  MIN_BAR_PERCENT,
  normalizeShareLabel,
  phaseStatusOf,
  SHARE_LABEL_MAX,
  shareLinkStatus,
  shareLinkTitle,
  timelineLayout,
} from "./shareLinks";

const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("shareLinkStatus", () => {
  const base = { expiresAt: "2026-10-31T12:00:00.000Z", revokedAt: null };

  it("active before expiry", () => {
    expect(shareLinkStatus(base, NOW)).toBe("active");
  });

  it("expired at and after the expiry instant", () => {
    expect(shareLinkStatus({ ...base, expiresAt: "2026-10-01T12:00:00.000Z" }, NOW)).toBe("expired");
    expect(shareLinkStatus({ ...base, expiresAt: "2026-09-01T00:00:00.000Z" }, NOW)).toBe("expired");
  });

  it("revoked wins over expired and active", () => {
    const revokedAt = "2026-09-20T00:00:00.000Z";
    expect(shareLinkStatus({ ...base, revokedAt }, NOW)).toBe("revoked");
    expect(shareLinkStatus({ expiresAt: "2026-09-01T00:00:00.000Z", revokedAt }, NOW)).toBe("revoked");
  });

  it("an unreadable expiry is not treated as expired", () => {
    expect(shareLinkStatus({ expiresAt: "nope", revokedAt: null }, NOW)).toBe("active");
  });
});

describe("share link text helpers", () => {
  it("titles unlabelled links", () => {
    expect(shareLinkTitle({ label: null })).toBe("Untitled link");
    expect(shareLinkTitle({ label: "  " })).toBe("Untitled link");
    expect(shareLinkTitle({ label: "For Nusantara IT" })).toBe("For Nusantara IT");
  });

  it("prefixes relative urls with the origin", () => {
    expect(absoluteShareUrl("/share/abc", "https://solvro.example")).toBe("https://solvro.example/share/abc");
    expect(absoluteShareUrl("/share/abc", "https://solvro.example/")).toBe("https://solvro.example/share/abc");
    expect(absoluteShareUrl("share/abc", "http://localhost:5173")).toBe("http://localhost:5173/share/abc");
  });

  it("leaves absolute urls alone", () => {
    expect(absoluteShareUrl("https://other.example/share/abc", "https://solvro.example")).toBe(
      "https://other.example/share/abc",
    );
  });

  it("normalizes the label", () => {
    expect(normalizeShareLabel("   ")).toBeUndefined();
    expect(normalizeShareLabel("  Acme  ")).toBe("Acme");
    expect(normalizeShareLabel("x".repeat(200))).toHaveLength(SHARE_LABEL_MAX);
  });
});

describe("phaseStatusOf", () => {
  it("passes the three known values and degrades the rest", () => {
    expect(phaseStatusOf("done")).toBe("done");
    expect(phaseStatusOf("in_progress")).toBe("in_progress");
    expect(phaseStatusOf("not_started")).toBe("not_started");
    expect(phaseStatusOf("weird")).toBe("not_started");
    expect(phaseStatusOf(undefined)).toBe("not_started");
  });
});

describe("timelineLayout", () => {
  it("has no range when no phase has a date", () => {
    const out = timelineLayout([{ startDate: null, endDate: null }]);
    expect(out.range).toBeNull();
    expect(out.bars).toEqual([null]);
    expect(out.today).toBeNull();
  });

  it("positions bars across the inclusive overall range", () => {
    // 10 days: Oct 1 .. Oct 10.
    const out = timelineLayout([
      { startDate: "2026-10-01", endDate: "2026-10-04" },
      { startDate: "2026-10-05", endDate: "2026-10-10" },
    ]);
    expect(out.range).toEqual({ start: "2026-10-01", end: "2026-10-10" });
    expect(out.bars[0]).toEqual({ left: 0, width: 40 });
    expect(out.bars[1]).toEqual({ left: 40, width: 60 });
  });

  it("accepts ISO instants and reads them as UTC calendar days", () => {
    const out = timelineLayout([
      { startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-02T00:00:00.000Z" },
    ]);
    expect(out.range).toEqual({ start: "2026-10-01", end: "2026-10-02" });
    expect(out.bars[0]).toEqual({ left: 0, width: 100 });
  });

  it("collapses a single-date phase to that day and keeps it visible", () => {
    const out = timelineLayout([
      { startDate: "2026-10-01", endDate: "2026-10-30" },
      { startDate: null, endDate: "2026-10-15" },
    ]);
    const bar = out.bars[1];
    expect(bar).not.toBeNull();
    expect(bar!.width).toBeGreaterThanOrEqual(MIN_BAR_PERCENT);
    expect(bar!.left + bar!.width).toBeLessThanOrEqual(100);
  });

  it("never lets a minimum-width bar spill past the right edge", () => {
    const out = timelineLayout([
      { startDate: "2026-01-01", endDate: "2026-12-31" },
      { startDate: "2026-12-31", endDate: "2026-12-31" },
    ]);
    const bar = out.bars[1]!;
    expect(bar.left + bar.width).toBeCloseTo(100, 5);
  });

  it("returns null for a dateless phase among dated ones", () => {
    const out = timelineLayout([
      { startDate: "2026-10-01", endDate: "2026-10-05" },
      { startDate: null, endDate: null },
    ]);
    expect(out.bars[0]).not.toBeNull();
    expect(out.bars[1]).toBeNull();
  });

  it("swaps a reversed pair instead of drawing a negative bar", () => {
    const out = timelineLayout([{ startDate: "2026-10-10", endDate: "2026-10-01" }]);
    expect(out.range).toEqual({ start: "2026-10-01", end: "2026-10-10" });
    expect(out.bars[0]!.width).toBe(100);
  });

  it("places today inside the range and omits it outside", () => {
    const phases = [{ startDate: "2026-10-01", endDate: "2026-10-10" }];
    expect(timelineLayout(phases, "2026-10-05").today).toBeCloseTo(45, 5);
    expect(timelineLayout(phases, "2026-09-30").today).toBeNull();
    expect(timelineLayout(phases, "2026-10-11").today).toBeNull();
    expect(timelineLayout(phases, null).today).toBeNull();
  });
});

describe("guestErrorCopy", () => {
  it("treats an unknown or expired link as final", () => {
    const copy = guestErrorCopy(new ApiError(404, "not found", null));
    expect(copy.final).toBe(true);
    expect(copy.title).toBe("This link has expired or is no longer available");
  });
  it("lets a guest retry after rate limiting or a failure", () => {
    expect(guestErrorCopy(new ApiError(429, "slow down", null))).toMatchObject({ final: false, icon: "hourglass_top" });
    expect(guestErrorCopy(new ApiError(500, "boom", null)).final).toBe(false);
    expect(guestErrorCopy(new TypeError("network")).title).toBe("Something went wrong");
  });
});
