import { describe, expect, it } from "vitest";
import { buildTimezoneGroups } from "./itopTimezones";

describe("buildTimezoneGroups", () => {
  it("puts the UTC group first", () => {
    const groups = buildTimezoneGroups([], ["Pacific/Auckland", "Asia/Tokyo"]);
    expect(groups[0]!.region).toBe("UTC");
    expect(groups[0]!.zones).toContain("UTC");
  });

  it("unions in the saved zone even when it's an alias absent from supportedZones", () => {
    const groups = buildTimezoneGroups(["US/Eastern"], ["Europe/Paris", "Asia/Tokyo"]);
    const allZones = groups.flatMap((g) => g.zones);
    expect(allZones).toContain("US/Eastern");
    // Grouped under its own "US" region (the part before the first "/"),
    // not silently dropped or merged into "America".
    const usGroup = groups.find((g) => g.region === "US");
    expect(usGroup?.zones).toContain("US/Eastern");
  });

  it("unions in a GMT-offset alias the same way", () => {
    const groups = buildTimezoneGroups(["Etc/GMT+5"], ["Europe/Paris"]);
    const allZones = groups.flatMap((g) => g.zones);
    expect(allZones).toContain("Etc/GMT+5");
  });

  it("ignores an empty extraZones entry instead of adding a bogus zone/group", () => {
    const groups = buildTimezoneGroups([""], ["Europe/Paris"]);
    const allZones = groups.flatMap((g) => g.zones);
    expect(allZones).not.toContain("");
  });

  it("falls back to the hardcoded common-zone list when supportedZones is empty (Intl.supportedValuesOf missing)", () => {
    const groups = buildTimezoneGroups([], []);
    const allZones = groups.flatMap((g) => g.zones);
    expect(allZones).toContain("UTC");
    expect(allZones).toContain("Europe/Paris");
    expect(allZones).toContain("Asia/Jakarta");
    expect(allZones).toContain("Asia/Kuala_Lumpur");
    expect(allZones).toContain("Asia/Singapore");
    expect(allZones).toContain("Europe/London");
    expect(allZones).toContain("America/New_York");
  });

  it("still finds the saved zone when falling back and it isn't in the hardcoded list", () => {
    const groups = buildTimezoneGroups(["Pacific/Auckland"], []);
    const allZones = groups.flatMap((g) => g.zones);
    expect(allZones).toContain("Pacific/Auckland");
  });

  it("never duplicates a zone present in both supportedZones and extraZones", () => {
    const groups = buildTimezoneGroups(["Europe/Paris"], ["Europe/Paris", "Asia/Tokyo"]);
    const europeGroup = groups.find((g) => g.region === "Europe");
    const count = europeGroup?.zones.filter((z) => z === "Europe/Paris").length ?? 0;
    expect(count).toBe(1);
  });

  it("sorts zones within a region alphabetically", () => {
    const groups = buildTimezoneGroups([], ["Europe/Warsaw", "Europe/Berlin", "Europe/Paris"]);
    const europeGroup = groups.find((g) => g.region === "Europe");
    expect(europeGroup?.zones).toEqual(["Europe/Berlin", "Europe/Paris", "Europe/Warsaw"]);
  });
});
