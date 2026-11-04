import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/queries";
import type { TaskStatusDef } from "@/lib/queries";
import {
  columnIdOf,
  compareTasksByPosition,
  projectToColumns,
  sortStatusDefsForBoard,
  sortTasksCanonical,
  statusIdOfColumn,
} from "./adapter";
import { withStatus } from "@/lib/taskStatusFixture";

function makeTask(
  overrides: Partial<Task> & Pick<Task, "id" | "title" | "status" | "position">,
): Task {
  return withStatus({
    projectId: 1,
    description: null,
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
    sectionId: null,
    section: null,
    labels: [],
    _count: { subtasks: 0, comments: 0 },
    itopTicketRef: null,
    epicId: null,
    ...overrides,
  });
}

// The seeded defs (ids as lib/taskStatusFixture.ts), in board order.
const DEFS: TaskStatusDef[] = [
  { id: 1, name: "To do", category: "TODO", color: "gray", position: 0, isDefault: true },
  { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", position: 1, isDefault: true },
  { id: 3, name: "Done", category: "DONE", color: "emerald", position: 2, isDefault: true },
];
const TODO = columnIdOf({ id: 1 });
const IN_PROGRESS = columnIdOf({ id: 2 });
const DONE = columnIdOf({ id: 3 });

/** scenarios.md "Reference fixture". */
function referenceFixture(): Task[] {
  return [
    makeTask({ id: 1, title: "A", status: "TODO", position: 0 }),
    makeTask({ id: 2, title: "B", status: "TODO", position: 1 }),
    makeTask({ id: 3, title: "C", status: "TODO", position: 2 }),
    makeTask({ id: 4, title: "D", status: "IN_PROGRESS", position: 3 }),
    makeTask({ id: 5, title: "E", status: "DONE", position: 4 }),
  ];
}

describe("adapter — projectToColumns", () => {
  it("groups the reference fixture into TODO/IN_PROGRESS/DONE identically to the old groupedAll", () => {
    const tasks = referenceFixture();
    const columns = projectToColumns(tasks, DEFS);

    expect(columns[TODO].map((t) => t.title)).toEqual(["A", "B", "C"]);
    expect(columns[IN_PROGRESS].map((t) => t.title)).toEqual(["D"]);
    expect(columns[DONE].map((t) => t.title)).toEqual(["E"]);
  });

  it("always includes all three status columns, empty arrays allowed, on an empty input", () => {
    const columns = projectToColumns([], DEFS);
    expect(columns).toEqual({ [TODO]: [], [IN_PROGRESS]: [], [DONE]: [] });
  });

  it("orders within a column by position ascending, id ascending tiebreak (out-of-order input, tied positions)", () => {
    const tied = [
      makeTask({ id: 3, title: "third-by-id", status: "TODO", position: 0 }),
      makeTask({ id: 1, title: "first-by-id", status: "TODO", position: 0 }),
      makeTask({ id: 2, title: "middle-by-id", status: "TODO", position: 5 }),
    ];

    const columns = projectToColumns(tied, DEFS);

    // Two tasks tie at position 0 -> id ascending tiebreak (1 before 3);
    // position 5 sorts after both regardless of input order.
    expect(columns[TODO].map((t) => t.id)).toEqual([1, 3, 2]);
  });

  it("filtering hides cards from the projected columns without touching input order or position", () => {
    const tasks = referenceFixture();
    const [A, B] = tasks;
    const hideB = (t: Task) => t.id !== B.id;

    const columns = projectToColumns(tasks, DEFS, hideB);

    expect(columns[TODO].map((t) => t.id)).toEqual([A.id, 3]); // B (id 2) hidden
    // Original task objects/positions untouched by filtering.
    expect(B.position).toBe(1);
    expect(tasks.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("filters out subtasks (parentTaskId !== null) itself, without trusting the caller (Phase 1 review finding 8)", () => {
    // scenarios.md's own "Subtasks of A" fixture: S1/S2, children of A (id 1).
    const tasks = [
      ...referenceFixture(),
      makeTask({ id: 6, title: "S1", status: "TODO", position: 0, parentTaskId: 1 }),
      makeTask({ id: 7, title: "S2", status: "TODO", position: 1, parentTaskId: 1 }),
    ];

    const columns = projectToColumns(tasks, DEFS);

    // Top-level TODO membership is unchanged by the subtasks being present
    // in the input list at all.
    expect(columns[TODO].map((t) => t.id)).toEqual([1, 2, 3]);
    // No subtask (parentTaskId !== null) ends up in any column.
    const allColumnTasks = Object.values(columns).flat();
    expect(allColumnTasks.some((t) => t.parentTaskId !== null)).toBe(false);
    expect(allColumnTasks.map((t) => t.id)).not.toContain(6);
    expect(allColumnTasks.map((t) => t.id)).not.toContain(7);
  });
});

describe("adapter — custom statuses", () => {
  const QA: TaskStatusDef = { id: 10, name: "QA / UAT", category: "IN_PROGRESS", color: "violet", position: 5, isDefault: false };
  const WONT: TaskStatusDef = { id: 11, name: "Won't do", category: "DONE", color: "gray", position: 6, isDefault: false };

  it("sortStatusDefsForBoard orders by category, then position, regardless of input order", () => {
    // QA's position (5) is after Done's (2), but its category is earlier.
    const sorted = sortStatusDefsForBoard([WONT, DEFS[2], QA, DEFS[0], DEFS[1]]);
    expect(sorted.map((d) => d.name)).toEqual(["To do", "In progress", "QA / UAT", "Done", "Won't do"]);
  });

  it("a custom status is its own column; same-category tasks are split by statusId", () => {
    const tasks = [
      makeTask({ id: 1, title: "A", status: "TODO", position: 0 }),
      makeTask({ id: 2, title: "D", status: "IN_PROGRESS", position: 1 }),
      makeTask({ id: 3, title: "Q", status: "IN_PROGRESS", position: 2, statusId: QA.id, statusDef: QA }),
    ];
    const columns = projectToColumns(tasks, sortStatusDefsForBoard([...DEFS, QA]));

    expect(Object.keys(columns)).toEqual([TODO, IN_PROGRESS, columnIdOf(QA), DONE]);
    expect(columns[IN_PROGRESS].map((t) => t.title)).toEqual(["D"]);
    expect(columns[columnIdOf(QA)].map((t) => t.title)).toEqual(["Q"]);
  });

  it("tasks in a column left off the board (collapsed) are not projected", () => {
    const tasks = [
      makeTask({ id: 1, title: "A", status: "TODO", position: 0 }),
      makeTask({ id: 5, title: "W", status: "DONE", position: 1, statusId: WONT.id, statusDef: WONT }),
    ];
    const columns = projectToColumns(tasks, DEFS);
    expect(Object.values(columns).flat().map((t) => t.title)).toEqual(["A"]);
  });

  it("column ids round-trip and never collide with an item id (a bare number)", () => {
    expect(statusIdOfColumn(columnIdOf(QA))).toBe(10);
    expect(statusIdOfColumn("10")).toBeNull();
    expect(statusIdOfColumn("status-0")).toBeNull();
    expect(statusIdOfColumn("status-x")).toBeNull();
    expect(statusIdOfColumn("TODO")).toBeNull();
  });
});

describe("adapter — sort helpers", () => {
  it("compareTasksByPosition / sortTasksCanonical produce the same canonical order projectToColumns relies on", () => {
    const shuffled = [
      makeTask({ id: 5, title: "E", status: "DONE", position: 4 }),
      makeTask({ id: 1, title: "A", status: "TODO", position: 0 }),
      makeTask({ id: 4, title: "D", status: "IN_PROGRESS", position: 3 }),
      makeTask({ id: 2, title: "B", status: "TODO", position: 1 }),
      makeTask({ id: 3, title: "C", status: "TODO", position: 2 }),
    ];

    const sorted = sortTasksCanonical(shuffled);
    expect(sorted.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
    // Does not mutate the input array.
    expect(shuffled.map((t) => t.id)).toEqual([5, 1, 4, 2, 3]);
    // Exported comparator matches sortTasksCanonical's own ordering.
    expect([...shuffled].sort(compareTasksByPosition).map((t) => t.id)).toEqual(
      sorted.map((t) => t.id),
    );
  });
});
