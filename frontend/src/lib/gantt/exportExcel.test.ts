import { describe, expect, it } from "vitest";
import { buildTasksSheet } from "./exportExcel";
import type { Row } from "./geometry";
import type { Epic, Task } from "@/lib/queries";

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

// Minimal-but-valid Task fixture (Task carries a lot of required fields
// irrelevant to the Epic column) — only `epicId` and `status` vary per test.
function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    projectId: 1,
    title: "Task",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    startDate: null,
    dueDate: null,
    isMilestone: false,
    isCriticalPath: false,
    baselineStartDate: null,
    baselineDueDate: null,
    assignedToId: null,
    assignedTo: null,
    parentTaskId: null,
    sectionId: 1,
    section: null,
    epicId: null,
    position: 0,
    labels: [],
    _count: { subtasks: 0, comments: 0 },
    itopTicketRef: null,
    ...overrides,
  };
}

function epicFixture(id: number, title: string): Epic {
  return {
    id,
    projectId: 1,
    title,
    description: null,
    status: "TODO",
    color: "#94a3b8",
    ownerId: null,
    owner: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    progress: { done: 0, total: 0 },
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
      "Epic",
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
      "Epic",
      "Title",
      "Status",
      "Priority",
      "Start",
      "Due",
    ]);
    for (const row of rows) expect(row.criticalPath).toBeUndefined();
  });
});

// Epic column (docs/archive/plans/epics-spec.md §6 last bullet, §7 T7): one "Epic"
// column on task/subtask rows, right after Section. A subtask always has
// `epicId: null` on its own task record and inherits its parent's epic for
// display (§4) — `buildTasksSheet` resolves that by walking the subtask
// row's `parentRowId` back to the parent task row.
describe("buildTasksSheet — Epic column", () => {
  const epics = [epicFixture(10, "Epic Ten"), epicFixture(20, "Epic Twenty")];

  it("exports the epic title on a task row that belongs to an epic", () => {
    const parentRow: Row = {
      ...taskRow("task-1"),
      taskId: 1,
      task: taskFixture({ id: 1, epicId: 10 }),
    };
    const { rows } = buildTasksSheet([section, parentRow], epics);
    expect(rows).toHaveLength(1);
    expect(rows[0].epic).toBe("Epic Ten");
  });

  it("exports the parent's epic title on a subtask row (subtasks inherit, never carry their own epicId)", () => {
    const parentRow: Row = {
      ...taskRow("task-1"),
      taskId: 1,
      task: taskFixture({ id: 1, epicId: 20 }),
    };
    const subtaskRow: Row = {
      id: "task-2",
      kind: "subtask",
      depth: 2,
      name: "Subtask",
      start: START,
      end: START,
      parentRowId: "task-1",
      taskId: 2,
      sectionId: 1,
      task: taskFixture({ id: 2, parentTaskId: 1, epicId: null }),
    };
    const { rows } = buildTasksSheet([section, parentRow, subtaskRow], epics);
    expect(rows).toHaveLength(2);
    expect(rows[0].epic).toBe("Epic Twenty");
    expect(rows[1].epic).toBe("Epic Twenty");
  });

  it("exports an empty Epic cell for a task with no epic", () => {
    const parentRow: Row = {
      ...taskRow("task-1"),
      taskId: 1,
      task: taskFixture({ id: 1, epicId: null }),
    };
    const { rows } = buildTasksSheet([section, parentRow], epics);
    expect(rows[0].epic).toBe("");
  });
});
