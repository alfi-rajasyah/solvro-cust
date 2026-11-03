// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { withStatus } from "@/lib/taskStatusFixture";
import type { Task } from "@/lib/queries";
import { TaskStatusCell, TaskStatusDot } from "./TreeCells";

afterEach(cleanup);

const base = {
  id: 1, projectId: 1, title: "T", description: null, status: "IN_PROGRESS", priority: "MEDIUM",
  startDate: null, dueDate: null, isMilestone: false, isCriticalPath: false, baselineStartDate: null,
  baselineDueDate: null, assignedToId: null, assignedTo: null, parentTaskId: null, sectionId: null,
  section: null, epicId: null, position: 0, labels: [], _count: { subtasks: 0, comments: 0 }, itopTicketRef: null,
} as unknown as Task;

describe("Gantt tree status cell", () => {
  it("shows the workspace status name and tone (bars stay category-based elsewhere)", () => {
    const task = withStatus({
      ...base,
      statusDef: { id: 4, name: "QA / UAT", color: "violet", category: "IN_PROGRESS", position: 3 },
    });
    const { container } = render(<TaskStatusCell task={task} />);
    expect(container.textContent).toBe("QA / UAT");
    expect(container.innerHTML).toContain("bg-chip-violet-bg");
  });

  it("with the seeded status reads exactly as the bare category did", () => {
    const { container } = render(<TaskStatusCell task={withStatus(base)} />);
    expect(container.textContent).toBe("In progress");
    expect(container.innerHTML).toContain("bg-primary/10");
  });

  it("dot takes the status tone, or the category's without one", () => {
    const a = render(<TaskStatusDot status="IN_PROGRESS" def={{ color: "amber" }} />);
    expect(a.container.innerHTML).toContain("bg-chip-amber-text");
    cleanup();
    const b = render(<TaskStatusDot status="DONE" />);
    expect(b.container.innerHTML).toContain("bg-chip-emerald-text");
  });
});
