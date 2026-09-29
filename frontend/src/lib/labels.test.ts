import { describe, expect, it } from "vitest";
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  RISK_CATEGORY_LABEL,
  RISK_STATUS_LABEL,
  TASK_STATUS_LABEL,
  WEEKLY_HEALTH_LABEL,
  WEEKLY_STATUS_LABEL,
  priorityOptions,
  projectStatusOptions,
  riskCategoryOptions,
  riskLevel,
  riskLevelFromScore,
  riskStatusOptions,
  taskStatusOptions,
} from "./labels";

describe("label maps", () => {
  it("uses the agreed task status words", () => {
    expect(TASK_STATUS_LABEL).toEqual({
      TODO: "To do",
      IN_PROGRESS: "In progress",
      DONE: "Done",
    });
  });

  it("uses the agreed weekly update words", () => {
    expect(WEEKLY_STATUS_LABEL).toEqual({
      NOT_STARTED: "None this week",
      DRAFT: "Draft",
      DONE: "Done",
    });
  });

  it("uses title-case weekly health words", () => {
    expect(WEEKLY_HEALTH_LABEL).toEqual({
      GREEN: "Green",
      AMBER: "Amber",
      RED: "Red",
    });
  });

  it("uses the agreed priority words", () => {
    expect(PRIORITY_LABEL).toEqual({
      LOW: "Low",
      MEDIUM: "Medium",
      HIGH: "High",
      URGENT: "Urgent",
    });
  });

  it("uses the agreed risk status words", () => {
    expect(RISK_STATUS_LABEL).toEqual({
      OPEN: "Open",
      MITIGATED: "Mitigated",
      CLOSED: "Closed",
    });
  });

  it("uses the agreed project status words", () => {
    expect(PROJECT_STATUS_LABEL).toEqual({
      PLANNING: "Planning",
      ACTIVE: "Active",
      ON_HOLD: "On hold",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled",
    });
  });

  it("labels every risk category", () => {
    expect(Object.keys(RISK_CATEGORY_LABEL)).toEqual([
      "EXTERNAL",
      "INTERNAL",
      "TECHNICAL",
      "ORGANIZATIONAL",
      "FINANCIAL",
    ]);
  });

  it("never shows an upper-snake-case enum as a label", () => {
    const all = [
      TASK_STATUS_LABEL,
      PRIORITY_LABEL,
      RISK_STATUS_LABEL,
      RISK_CATEGORY_LABEL,
      PROJECT_STATUS_LABEL,
    ].flatMap((m) => Object.values(m));
    for (const label of all) expect(label).not.toMatch(/^[A-Z_]+$/);
  });
});

describe("option lists", () => {
  it("keeps enum order and pairs value with label", () => {
    expect(taskStatusOptions).toEqual([
      { value: "TODO", label: "To do" },
      { value: "IN_PROGRESS", label: "In progress" },
      { value: "DONE", label: "Done" },
    ]);
    expect(priorityOptions.map((o) => o.value)).toEqual([
      "LOW",
      "MEDIUM",
      "HIGH",
      "URGENT",
    ]);
    expect(riskStatusOptions.map((o) => o.label)).toEqual([
      "Open",
      "Mitigated",
      "Closed",
    ]);
    expect(projectStatusOptions.map((o) => o.value)).toEqual([
      "PLANNING",
      "ACTIVE",
      "ON_HOLD",
      "COMPLETED",
      "CANCELLED",
    ]);
    expect(riskCategoryOptions).toHaveLength(5);
  });
});

describe("riskLevel", () => {
  it("is Low up to a score of 8", () => {
    expect(riskLevel(1, 1)).toBe("Low");
    expect(riskLevel(2, 4)).toBe("Low");
    expect(riskLevelFromScore(8)).toBe("Low");
  });

  it("is Medium from 9 to 15", () => {
    expect(riskLevel(3, 3)).toBe("Medium");
    expect(riskLevel(3, 5)).toBe("Medium");
    expect(riskLevelFromScore(15)).toBe("Medium");
  });

  it("is High above 15", () => {
    expect(riskLevel(4, 4)).toBe("High");
    expect(riskLevel(5, 5)).toBe("High");
    expect(riskLevelFromScore(16)).toBe("High");
  });
});
