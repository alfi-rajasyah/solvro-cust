// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Task } from "@/lib/queries";
import { TaskCard } from "./cards";

afterEach(cleanup);

const base = {
  id: 1,
  title: "Card",
  status: "TODO",
  priority: "MEDIUM",
  labels: [],
  assignedTo: null,
  dueDate: null,
  epicId: null,
  isCriticalPath: false,
  _count: { comments: 0 },
} as unknown as Task;

function show(over: Partial<Task>) {
  render(
    <TaskCard
      task={{ ...base, ...over }}
      subtaskMap={new Map()}
      epicMap={new Map()}
      canDrag={false}
      onClick={() => {}}
    />,
  );
}

describe("kanban TaskCard story points", () => {
  it("shows the number when set, including 0", () => {
    show({ storyPoints: 5 });
    expect(screen.getByTestId("card-story-points").textContent).toContain("5");
    cleanup();
    show({ storyPoints: 0 });
    expect(screen.getByTestId("card-story-points").textContent).toContain("0");
  });
  it("shows nothing when not estimated", () => {
    show({ storyPoints: null });
    expect(screen.queryByTestId("card-story-points")).toBeNull();
  });
});
