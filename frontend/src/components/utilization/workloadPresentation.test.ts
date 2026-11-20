import { describe, expect, it } from "vitest";
import { isOverdueDay, scopeNote, taskHref, workloadStats } from "./workloadPresentation";

describe("workloadStats", () => {
  it("returns the five stats in column order, flagging overdue only above zero", () => {
    const stats = workloadStats({ open: 9, dueThisWeek: 2, overdue: 3, activeInWeek: 4, storyPoints: 21 });
    expect(stats.map((s) => [s.key, s.value])).toEqual([
      ["open", 9],
      ["due", 2],
      ["overdue", 3],
      ["active", 4],
      ["points", 21],
    ]);
    expect(stats.find((s) => s.key === "overdue")?.tone).toBe("bad");
    const calm = workloadStats({ open: 1, dueThisWeek: 0, overdue: 0, activeInWeek: 0, storyPoints: 0 });
    expect(calm.find((s) => s.key === "overdue")?.tone).toBe("neutral");
  });
});

describe("scopeNote", () => {
  it("says something different for each level", () => {
    expect(new Set([scopeNote("own"), scopeNote("team"), scopeNote("all")]).size).toBe(3);
  });
});

describe("isOverdueDay", () => {
  it("is true only for a due day before today", () => {
    expect(isOverdueDay("2026-11-17", "2026-11-18")).toBe(true);
    expect(isOverdueDay("2026-11-18", "2026-11-18")).toBe(false);
    expect(isOverdueDay(null, "2026-11-18")).toBe(false);
  });
});

describe("taskHref", () => {
  it("opens the task panel on the project's list view", () => {
    expect(taskHref(4, 12)).toBe("/projects/4/list?task=12");
  });
});
