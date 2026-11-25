// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkloadResponse, WorkloadTasksResponse } from "@/lib/queries";

const state: { table: unknown; tasks: WorkloadTasksResponse | undefined; taskCalls: unknown[] } = {
  table: undefined,
  tasks: undefined,
  taskCalls: [],
};

vi.mock("@/lib/queries", () => ({
  useWorkload: () => state.table,
  useWorkloadTasks: (assignee: unknown, opts?: unknown) => {
    state.taskCalls.push([assignee, opts]);
    return { data: state.tasks, isLoading: false, isError: false };
  },
}));

import { WorkloadTab } from "./WorkloadTab";

const response: WorkloadResponse = {
  week: { key: "2026-W47", start: "2026-11-16", days: [] },
  utcOffsetMinutes: 0,
  today: "2026-11-18",
  scope: "team",
  rows: [
    { key: "user:1", userId: 1, name: "ana", active: true, open: 5, dueThisWeek: 2, overdue: 1, activeInWeek: 3, storyPoints: 13 },
    { key: "user:2", userId: 2, name: "bo", active: false, open: 1, dueThisWeek: 0, overdue: 0, activeInWeek: 0, storyPoints: 0 },
    { key: "unassigned", userId: null, name: "Unassigned", active: true, open: 2, dueThisWeek: 0, overdue: 0, activeInWeek: 0, storyPoints: 0 },
  ],
  totals: { open: 8, dueThisWeek: 2, overdue: 1, activeInWeek: 3, storyPoints: 13 },
};

function show() {
  render(
    <MemoryRouter>
      <WorkloadTab week="2026-W47" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  state.table = undefined;
  state.tasks = undefined;
  state.taskCalls = [];
});

describe("WorkloadTab", () => {
  it("renders the summary strip, one row per person and the scope note", () => {
    state.table = { data: response, isLoading: false, isError: false, error: null };
    show();
    expect(screen.getByTestId("workload-stat-open-value").textContent).toBe("8");
    expect(screen.getByTestId("workload-stat-points-value").textContent).toBe("13");
    const rows = screen.getAllByTestId("workload-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("ana")).toBeTruthy();
    expect(within(rows[1]).getByText("Inactive")).toBeTruthy();
    expect(within(rows[2]).getByText("Unassigned")).toBeTruthy();
    expect(screen.getByTestId("workload-scope-note").textContent).toContain("projects you own");
  });

  it("opens a person's tasks on click, each linking to the task panel", () => {
    state.table = { data: response, isLoading: false, isError: false, error: null };
    state.tasks = {
      truncated: false,
      hiddenCount: 2,
      tasks: [
        {
          id: 12,
          title: "Ship it",
          projectId: 4,
          projectName: "Apollo",
          status: "IN_PROGRESS",
          statusDef: { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary" },
          startDate: null,
          dueDate: "2026-11-17T00:00:00.000Z",
          storyPoints: 3,
          parentTaskId: null,
        },
      ],
    };
    show();
    expect(screen.queryByTestId("workload-detail")).toBeNull();
    fireEvent.click(within(screen.getAllByTestId("workload-row")[0]).getByRole("button"));
    const link = screen.getByTestId("workload-task") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/projects/4/list?task=12");
    expect(link.textContent).toContain("Ship it");
    expect(link.textContent).toContain("Apollo");
    expect(link.textContent).toContain("In progress");
    expect(link.textContent).toContain("1d late");
    expect(screen.getByTestId("workload-hidden").textContent).toBe("2 more open tasks in projects you can't open.");
    expect(state.taskCalls.at(-1)).toEqual([1, undefined]);
    // Clicking again collapses it.
    fireEvent.click(within(screen.getAllByTestId("workload-row")[0]).getByRole("button"));
    expect(screen.queryByTestId("workload-detail")).toBeNull();
  });

  it("asks for the unassigned list on the Unassigned row", () => {
    state.table = { data: response, isLoading: false, isError: false, error: null };
    show();
    fireEvent.click(within(screen.getAllByTestId("workload-row")[2]).getByRole("button"));
    expect((state.taskCalls.at(-1) as unknown[])[0]).toBe("unassigned");
  });

  it("shows an empty note when nobody holds open tasks", () => {
    state.table = {
      data: { ...response, rows: [], totals: { open: 0, dueThisWeek: 0, overdue: 0, activeInWeek: 0, storyPoints: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    };
    show();
    expect(screen.getByTestId("workload-no-rows")).toBeTruthy();
  });
});
