import { describe, expect, it } from "vitest";
import { newTodayChip, resolvedTodayChip, slaBreachedChip } from "./dailyStripPresentation";

describe("dailyStripPresentation", () => {
  it("labels the new/resolved chips with a fixed tone regardless of count", () => {
    expect(newTodayChip(0)).toEqual({ label: "0 new", tone: "violet" });
    expect(newTodayChip(2)).toEqual({ label: "2 new", tone: "violet" });
    expect(resolvedTodayChip(1)).toEqual({ label: "1 resolved", tone: "emerald" });
  });

  it("mutes the SLA-breached chip at zero and flags danger above zero", () => {
    expect(slaBreachedChip(0)).toEqual({ label: "0 SLA breached", tone: "gray" });
    expect(slaBreachedChip(1)).toEqual({ label: "1 SLA breached", tone: "rose" });
    expect(slaBreachedChip(4)).toEqual({ label: "4 SLA breached", tone: "rose" });
  });
});
