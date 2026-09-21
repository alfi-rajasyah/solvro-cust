import { describe, expect, it } from "vitest";
import { buildTasksSheet } from "./exportExcel";
import type { Row } from "./geometry";

// Critical Path mark (plan critical-path-mark.md §3): the Tasks sheet gains
// a "Critical Path" column only when at least one exported row is marked
// (the empty-project rule). `buildTasksSheet` is the pure column/row
// builder `exportGanttToExcel` feeds to the ExcelJS worksheet — asserted
// directly here, mirroring exportPdf.test.ts's `buildTaskTable` coverage.

const START = new Date(2026, 7, 1);

const section: Row = {
  id: "s1",
  kind: "section",
  depth: 0,
  name: "Phase 1",
  start: START,
  end: START,
  parentRowId: null,
  sectionId: 1,
};

function taskRow(id: string, isCriticalPath = false): Row {
  return {
    id,
    kind: "task",
    depth: 1,
    name: `Task ${id}`,
    start: START,
    end: START,
    parentRowId: "s1",
    taskId: 1,
    sectionId: 1,
    isCriticalPath,
  };
}

describe("buildTasksSheet", () => {
  it("adds a Critical Path column when one task is marked — the marked row reads \"Yes\", the unmarked row \"\"", () => {
    const { columns, rows, hasCriticalPath } = buildTasksSheet([
      section,
      taskRow("t1", true),
      taskRow("t2", false),
    ]);
    expect(hasCriticalPath).toBe(true);
    expect(columns.map((c) => c.header)).toEqual([
      "Section",
      "Title",
      "Status",
      "Priority",
      "Critical Path",
      "Start",
      "Due",
    ]);
    // The section row never enters the Tasks sheet.
    expect(rows).toHaveLength(2);
    expect(rows[0].criticalPath).toBe("Yes");
    expect(rows[1].criticalPath).toBe("");
  });

  it("omits the Critical Path column when no task is marked — original 6 columns only (empty-project rule)", () => {
    const { columns, rows, hasCriticalPath } = buildTasksSheet([
      section,
      taskRow("t1", false),
      taskRow("t2", false),
    ]);
    expect(hasCriticalPath).toBe(false);
    expect(columns.map((c) => c.header)).toEqual([
      "Section",
      "Title",
      "Status",
      "Priority",
      "Start",
      "Due",
    ]);
    for (const row of rows) expect(row.criticalPath).toBeUndefined();
  });
});
