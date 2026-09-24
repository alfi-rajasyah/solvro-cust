// Pure-function unit tests for lib/itop/sync.ts's normalizeCaseLog — the
// case-log ("public_log"/"private_log") normaliser used by both the sync
// pull and the Phase 5 write routes' post-write re-read. Covers the
// phase-review fix round (2026-09-23): entries must be sorted chronologically
// ascending BEFORE the 50-entry cap (some iTop installs answer newest-first,
// and capping on iTop's own array order would then silently keep the OLDEST
// entries instead of the newest), and a `message_html` fallback must be
// sanitized to plain text rather than leaking raw markup into the UI.
import { describe, expect, it } from "vitest";
import { normalizeCaseLog } from "../../src/lib/itop/sync.js";

describe("normalizeCaseLog", () => {
  it("sorts entries chronologically ascending even when iTop returns them newest-first", () => {
    const raw = {
      entries: [
        { date: "2026-01-03 10:00:00", user_login: "third", message: "third" },
        { date: "2026-01-01 10:00:00", user_login: "first", message: "first" },
        { date: "2026-01-02 10:00:00", user_login: "second", message: "second" },
      ],
    };

    const result = normalizeCaseLog(raw, "UTC");

    expect(result.map((e) => e.message)).toEqual(["first", "second", "third"]);
  });

  it("keeps an undated entry in its stable-sort position without disturbing the dated ones around it", () => {
    const raw = {
      entries: [
        { date: "2026-01-02 10:00:00", message: "dated-2" },
        { message: "undated-a" }, // no date field at all -> null
        { date: "2026-01-01 10:00:00", message: "dated-1" },
      ],
    };

    const result = normalizeCaseLog(raw, "UTC");

    expect(result.map((e) => e.message)).toContain("undated-a");
    expect(result.findIndex((e) => e.message === "dated-1")).toBeLessThan(
      result.findIndex((e) => e.message === "dated-2"),
    );
  });

  it("caps at the last 50 entries AFTER sorting, keeping the chronologically newest", () => {
    // Deliberately built newest-first (array index 0 = the highest minute),
    // so a cap that trusted iTop's raw array order would keep entries 0..49
    // (i.e. minutes 59..10) instead of the true newest 50 (minutes 10..59).
    const entries = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-01-01 00:${String(i).padStart(2, "0")}:00`,
      message: `entry-${i}`,
    })).reverse();

    const result = normalizeCaseLog({ entries }, "UTC");

    expect(result).toHaveLength(50);
    expect(result[0].message).toBe("entry-10");
    expect(result[49].message).toBe("entry-59");
  });

  it("sanitizes a message_html fallback: <br> becomes a newline, other tags are stripped, entities decoded", () => {
    const raw = {
      entries: [
        {
          date: "2026-01-01 00:00:00",
          message_html: "Called &amp; emailed the customer.<br>Waiting on <b>their</b> reply.",
        },
      ],
    };

    const result = normalizeCaseLog(raw, "UTC");

    expect(result[0].message).toBe("Called & emailed the customer.\nWaiting on their reply.");
  });

  it("never runs a plain message through the HTML sanitizer", () => {
    const raw = { entries: [{ date: "2026-01-01 00:00:00", message: "Plain <not-a-real-tag> text & stuff." }] };

    const result = normalizeCaseLog(raw, "UTC");

    expect(result[0].message).toBe("Plain <not-a-real-tag> text & stuff.");
  });

  it("handles a bare legacy string with no structured entries", () => {
    expect(normalizeCaseLog("Just some text", "UTC")).toEqual([{ date: null, author: null, message: "Just some text" }]);
    expect(normalizeCaseLog("", "UTC")).toEqual([]);
    expect(normalizeCaseLog(null, "UTC")).toEqual([]);
    expect(normalizeCaseLog(undefined, "UTC")).toEqual([]);
  });
});
