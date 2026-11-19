// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Task } from "@/lib/queries";
import { SubtaskRow } from "./cards";

afterEach(cleanup);

const base = { id: 1, title: "Sub", status: "TODO", assignedTo: null } as unknown as Task;

describe("kanban SubtaskRow critical path mark", () => {
  it("shows the mark only for a critical-path subtask", () => {
    render(<SubtaskRow task={{ ...base, isCriticalPath: true }} canToggle={false} />);
    expect(screen.getByText("Critical Path")).toBeTruthy();
    cleanup();
    render(<SubtaskRow task={{ ...base, isCriticalPath: false }} canToggle={false} />);
    expect(screen.queryByText("Critical Path")).toBeNull();
  });
});
