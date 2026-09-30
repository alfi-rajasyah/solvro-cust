import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  buildExpected,
  datePatchFromEdit,
  diffTaskForm,
  fieldsToAdopt,
  formatConflictRows,
  formatConflictValue,
  labelsFromIds,
  parseStaleWrite,
  withServerTask,
  type TaskFormValues,
} from "./taskConflict";
import type { Task } from "./queries";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 7,
    projectId: 1,
    title: "Ship it",
    description: "Some words",
    status: "TODO",
    priority: "MEDIUM",
    startDate: "2026-10-01T00:00:00.000Z",
    dueDate: "2026-10-05T00:00:00.000Z",
    isMilestone: false,
    isCriticalPath: false,
    baselineStartDate: null,
    baselineDueDate: null,
    assignedToId: 3,
    assignedTo: { id: 3, username: "ada", email: "ada@x.test" },
    parentTaskId: null,
    sectionId: 2,
    section: { id: 2, name: "Build", position: 0, color: "#000" },
    epicId: null,
    position: 0,
    labels: [
      { id: 10, projectId: 1, name: "bug", color: "#f00" },
      { id: 11, projectId: 1, name: "ux", color: "#0f0" },
    ],
    _count: { subtasks: 0, comments: 0 },
    itopTicketRef: null,
    ...over,
  };
}

function formFrom(t: Task, over: Partial<TaskFormValues> = {}): TaskFormValues {
  return {
    title: t.title,
    description: t.description?.trim() || null,
    status: t.status,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    assignedToId: t.assignedToId,
    parentTaskId: t.parentTaskId,
    sectionId: t.sectionId,
    epicId: t.epicId,
    labelIds: t.labels.map((l) => l.id),
    isCriticalPath: t.isCriticalPath,
    ...over,
  };
}

describe("buildExpected", () => {
  const task = makeTask();

  it("carries the task's current value for exactly the patched fields", () => {
    expect(buildExpected(task, { status: "DONE", priority: "HIGH" })).toEqual({
      status: "TODO",
      priority: "MEDIUM",
    });
  });

  it("keeps null as null (the field was empty)", () => {
    const t = makeTask({ assignedToId: null, description: null, startDate: null });
    expect(
      buildExpected(t, { assignedToId: 4, description: "x", startDate: "2026-10-02T00:00:00.000Z" }),
    ).toEqual({ assignedToId: null, description: null, startDate: null });
  });

  it("expresses labels as the id list", () => {
    expect(buildExpected(task, { labelIds: [11] })).toEqual({ labelIds: [10, 11] });
  });

  it("sends the dates as they were seen", () => {
    expect(
      buildExpected(task, { startDate: "2026-10-02T00:00:00.000Z", dueDate: null }),
    ).toEqual({ startDate: "2026-10-01T00:00:00.000Z", dueDate: "2026-10-05T00:00:00.000Z" });
  });

  it("returns undefined when the patch touches no tracked field", () => {
    expect(buildExpected(task, { position: 2 })).toBeUndefined();
    expect(buildExpected(task, { itopTicketRef: "R-000123" })).toBeUndefined();
    expect(buildExpected(task, {})).toBeUndefined();
  });

  it("tracks the toggles", () => {
    expect(buildExpected(task, { isCriticalPath: true, isMilestone: true })).toEqual({
      isCriticalPath: false,
      isMilestone: false,
    });
  });
});

describe("diffTaskForm", () => {
  const base = makeTask();

  it("is empty when nothing changed", () => {
    const { patch, expected } = diffTaskForm(base, formFrom(base));
    expect(patch).toEqual({});
    expect(expected).toBeUndefined();
  });

  it("returns only changed fields, with base values as expected", () => {
    const { patch, expected } = diffTaskForm(
      base,
      formFrom(base, { title: "Ship it now", priority: "URGENT" }),
    );
    expect(patch).toEqual({ title: "Ship it now", priority: "URGENT" });
    expect(expected).toEqual({ title: "Ship it", priority: "MEDIUM" });
  });

  it("compares dates as calendar days", () => {
    // Same day, different instant: not a change.
    const same = diffTaskForm(base, formFrom(base, { startDate: "2026-10-01" }));
    expect(same.patch).toEqual({});
    const moved = diffTaskForm(base, formFrom(base, { dueDate: "2026-10-09T00:00:00.000Z" }));
    expect(moved.patch).toEqual({ dueDate: "2026-10-09T00:00:00.000Z" });
    expect(moved.expected).toEqual({ dueDate: "2026-10-05T00:00:00.000Z" });
  });

  it("detects a cleared date", () => {
    const { patch, expected } = diffTaskForm(base, formFrom(base, { startDate: null }));
    expect(patch).toEqual({ startDate: null });
    expect(expected).toEqual({ startDate: "2026-10-01T00:00:00.000Z" });
  });

  it("treats a date set on a task that had none as a change from null", () => {
    const t = makeTask({ dueDate: null });
    const { patch, expected } = diffTaskForm(t, formFrom(t, { dueDate: "2026-11-01T00:00:00.000Z" }));
    expect(patch).toEqual({ dueDate: "2026-11-01T00:00:00.000Z" });
    expect(expected).toEqual({ dueDate: null });
  });

  it("compares labels as a set, regardless of order", () => {
    expect(diffTaskForm(base, formFrom(base, { labelIds: [11, 10] })).patch).toEqual({});
    const changed = diffTaskForm(base, formFrom(base, { labelIds: [10] }));
    expect(changed.patch).toEqual({ labelIds: [10] });
    expect(changed.expected).toEqual({ labelIds: [10, 11] });
  });

  it("handles nullable ids and description", () => {
    const { patch, expected } = diffTaskForm(
      base,
      formFrom(base, { assignedToId: null, sectionId: null, description: null }),
    );
    expect(patch).toEqual({ assignedToId: null, sectionId: null, description: null });
    expect(expected).toEqual({ assignedToId: 3, sectionId: 2, description: "Some words" });
  });

  it("does not flag a description that only differs by surrounding whitespace", () => {
    const t = makeTask({ description: "  padded  " });
    expect(diffTaskForm(t, formFrom(t, { description: "padded" })).patch).toEqual({});
    const empty = makeTask({ description: null });
    expect(diffTaskForm(empty, formFrom(empty)).patch).toEqual({});
  });

  it("diffs against the base it is given, not a refreshed task", () => {
    // Form opened with status TODO; user leaves it alone while the live task
    // has moved on to DONE. Nothing to send for status.
    const { patch } = diffTaskForm(base, formFrom(base, { title: "Renamed" }));
    expect(patch).toEqual({ title: "Renamed" });
    expect("status" in patch).toBe(false);
  });

  it("covers parent, epic and critical path", () => {
    const { patch, expected } = diffTaskForm(
      base,
      formFrom(base, { parentTaskId: 99, epicId: null, isCriticalPath: true }),
    );
    expect(patch).toEqual({ parentTaskId: 99, isCriticalPath: true });
    expect(expected).toEqual({ parentTaskId: null, isCriticalPath: false });
  });
});

describe("parseStaleWrite", () => {
  const task = makeTask();
  const body = {
    error: "Task changed",
    code: "stale_write",
    details: {
      conflicts: [
        { field: "status", expected: "TODO", current: "DONE" },
        { field: "labelIds", expected: [10], current: [10, 11] },
      ],
      task,
    },
  };

  it("parses a 409 stale_write", () => {
    const parsed = parseStaleWrite(new ApiError(409, "Task changed", body));
    expect(parsed?.conflicts).toHaveLength(2);
    expect(parsed?.conflicts[0]).toEqual({ field: "status", expected: "TODO", current: "DONE" });
    expect(parsed?.task.id).toBe(7);
  });

  it("ignores other errors", () => {
    expect(parseStaleWrite(new Error("boom"))).toBeNull();
    expect(parseStaleWrite(new ApiError(500, "x", body))).toBeNull();
    expect(parseStaleWrite(new ApiError(409, "x", { ...body, code: "conflict" }))).toBeNull();
    expect(parseStaleWrite(new ApiError(409, "x", null))).toBeNull();
    expect(parseStaleWrite(new ApiError(409, "x", { code: "stale_write" }))).toBeNull();
    expect(parseStaleWrite(undefined)).toBeNull();
  });

  it("drops unknown fields and returns null when none remain", () => {
    const odd = { ...body, details: { conflicts: [{ field: "nope", current: 1 }], task } };
    expect(parseStaleWrite(new ApiError(409, "x", odd))).toBeNull();
  });
});

describe("formatConflictRows", () => {
  const lookups = {
    users: [
      { id: 3, username: "ada" },
      { id: 4, username: "bob" },
    ],
    sections: [{ id: 2, name: "Build" }],
    epics: [{ id: 5, title: "Launch" }],
    labels: [
      { id: 10, name: "bug" },
      { id: 11, name: "ux" },
    ],
    tasks: [{ id: 99, title: "Parent" }],
  };

  it("labels the row and shows their value against yours", () => {
    const rows = formatConflictRows(
      [{ field: "status", expected: "TODO", current: "DONE" }],
      { status: "IN_PROGRESS" },
      lookups,
    );
    expect(rows).toEqual([
      { field: "status", label: "Status", now: "Done", yours: "In progress" },
    ]);
  });

  it("formats dates through the day formatter, ISO or plain day alike", () => {
    const [row] = formatConflictRows(
      [{ field: "dueDate", expected: "2026-10-01T00:00:00.000Z", current: "2026-10-05T00:00:00.000Z" }],
      { dueDate: "2026-10-09T00:00:00.000Z" },
      lookups,
    );
    expect(row.label).toBe("Due date");
    expect(row.now).toBe("5 Oct 2026");
    expect(row.yours).toBe("9 Oct 2026");
    expect(formatConflictValue("startDate", "2026-10-01")).toBe("1 Oct 2026");
  });

  it("shows null dates and ids as their empty words", () => {
    expect(formatConflictValue("dueDate", null)).toBe("No date");
    expect(formatConflictValue("assignedToId", null, lookups)).toBe("Unassigned");
    expect(formatConflictValue("sectionId", null, lookups)).toBe("No section");
    expect(formatConflictValue("epicId", null, lookups)).toBe("No epic");
    expect(formatConflictValue("parentTaskId", null, lookups)).toBe("No parent");
    expect(formatConflictValue("description", null)).toBe("(empty)");
  });

  it("resolves ids to names and falls back to #id", () => {
    expect(formatConflictValue("assignedToId", 4, lookups)).toBe("bob");
    expect(formatConflictValue("assignedToId", 42, lookups)).toBe("#42");
    expect(formatConflictValue("sectionId", 2, lookups)).toBe("Build");
    expect(formatConflictValue("epicId", 5, lookups)).toBe("Launch");
  });

  it("lists labels by name, and says so when there are none", () => {
    expect(formatConflictValue("labelIds", [10, 11], lookups)).toBe("bug, ux");
    expect(formatConflictValue("labelIds", [], lookups)).toBe("No labels");
    expect(formatConflictValue("labelIds", [10, 77], lookups)).toBe("bug, #77");
  });

  it("formats priority and booleans", () => {
    expect(formatConflictValue("priority", "URGENT")).toBe("Urgent");
    expect(formatConflictValue("isCriticalPath", true)).toBe("Yes");
    expect(formatConflictValue("isMilestone", false)).toBe("No");
  });

  it("uses the server task to name values the client lists lack", () => {
    const serverTask = makeTask({
      assignedTo: { id: 9, username: "zed", email: "z@x.test" },
      labels: [{ id: 12, projectId: 1, name: "new", color: "#00f" }],
    });
    const merged = withServerTask({}, serverTask);
    expect(formatConflictValue("assignedToId", 9, merged)).toBe("zed");
    expect(formatConflictValue("labelIds", [12], merged)).toBe("new");
    expect(withServerTask(lookups, undefined)).toBe(lookups);
  });
});

describe("datePatchFromEdit", () => {
  const base = makeTask(); // 2026-10-01 → 2026-10-05

  it("sends only the due date when only it changed", () => {
    const patch = datePatchFromEdit(base, base.startDate, "2026-10-09T00:00:00.000Z");
    expect(patch).toEqual({ dueDate: "2026-10-09T00:00:00.000Z" });
    expect("startDate" in patch).toBe(false);
  });

  it("sends only the start date when only it changed", () => {
    expect(datePatchFromEdit(base, "2026-09-28T00:00:00.000Z", base.dueDate)).toEqual({
      startDate: "2026-09-28T00:00:00.000Z",
    });
  });

  it("sends both when both changed, and nothing when neither did", () => {
    expect(datePatchFromEdit(base, "2026-09-28T00:00:00.000Z", "2026-10-09T00:00:00.000Z")).toEqual({
      startDate: "2026-09-28T00:00:00.000Z",
      dueDate: "2026-10-09T00:00:00.000Z",
    });
    expect(datePatchFromEdit(base, base.startDate, base.dueDate)).toEqual({});
  });

  it("compares calendar days, so a re-emitted instant of the same day is no change", () => {
    expect(datePatchFromEdit(base, "2026-10-01", "2026-10-05T12:00:00.000Z")).toEqual({});
  });

  it("detects a cleared date", () => {
    expect(datePatchFromEdit(base, null, base.dueDate)).toEqual({ startDate: null });
  });

  it("is measured against the snapshot, not a refreshed row", () => {
    // Snapshot: 1 Oct → 5 Oct. Someone moved the start to 3 Oct meanwhile; the
    // editor was only used to change the due date, and re-emits the snapshot start.
    const patch = datePatchFromEdit(base, base.startDate, "2026-10-08T00:00:00.000Z");
    expect(patch).toEqual({ dueDate: "2026-10-08T00:00:00.000Z" });
    expect(buildExpected(base, patch)).toEqual({ dueDate: "2026-10-05T00:00:00.000Z" });
  });
});

describe("labelsFromIds", () => {
  const bug = { id: 10, projectId: 1, name: "bug", color: "#f00" };
  const ux = { id: 11, projectId: 1, name: "ux", color: "#0f0" };
  const perf = { id: 12, projectId: 1, name: "perf", color: "#00f" };

  it("maps ids onto the project's labels, in id order", () => {
    expect(labelsFromIds([11, 10], [bug, ux, perf], [], 1)).toEqual([ux, bug]);
  });

  it("falls back to the task's current labels when the project list lacks one", () => {
    expect(labelsFromIds([10, 12], [bug], [perf], 1)).toEqual([bug, perf]);
    expect(labelsFromIds([10], undefined, [bug], 1)).toEqual([bug]);
  });

  it("uses a name-less placeholder for a label neither list knows yet", () => {
    const [placeholder] = labelsFromIds([99], [bug], [], 1);
    expect(placeholder).toMatchObject({ id: 99, projectId: 1, name: "" });
  });

  it("keeps the next expected right after a quick second toggle", () => {
    // Task starts with no labels; toggle bug, then ux, before any refetch.
    const t0 = makeTask({ labels: [] });
    const t1 = { ...t0, labels: labelsFromIds([10], [bug, ux], t0.labels, 1) };
    // The second toggle reads the optimistic state: it expects [bug], not [].
    expect(buildExpected(t1, { labelIds: [10, 11] })).toEqual({ labelIds: [10] });
  });
});

describe("fieldsToAdopt", () => {
  it("adopts clashing fields and every field the user never changed", () => {
    const adopt = fieldsToAdopt({ title: "Mine", priority: "HIGH" }, [{ field: "title" }]);
    expect(adopt.has("title")).toBe(true); // clashed
    expect(adopt.has("priority")).toBe(false); // mine, no clash — kept
    expect(adopt.has("status")).toBe(true); // untouched — take theirs
    expect(adopt.has("labelIds")).toBe(true);
  });

  it("keeps every changed field when nothing it touched clashed", () => {
    const adopt = fieldsToAdopt({ dueDate: null }, []);
    expect(adopt.has("dueDate")).toBe(false);
    expect(adopt.has("startDate")).toBe(true);
  });
});
