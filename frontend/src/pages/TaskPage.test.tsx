// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "@/lib/api";
import { TaskPage } from "./TaskPage";

const taskQuery = { current: {} as Record<string, unknown> };
const listQuery = { current: {} as Record<string, unknown> };
const listArgs = { current: [] as Array<number | null> };
const detailProps = { current: null as null | Record<string, unknown> };

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  return {
    ...actual,
    useTask: () => taskQuery.current,
    // The list exists only for the right project; anything else is not loaded yet.
    useProjectTasks: (id: number | null) => {
      listArgs.current.push(id);
      return id === 2 ? listQuery.current : { data: undefined, isError: false, refetch: vi.fn() };
    },
  };
});
vi.mock("@/components/TaskDetail", () => ({
  TaskDetail: (props: Record<string, unknown>) => {
    detailProps.current = props;
    return <div data-testid="detail" data-layout={String(props.layout)} />;
  },
}));
vi.mock("@/components/StatusSelect", () => ({ StatusSelect: () => null }));
vi.mock("@/components/TaskOptionsMenu", () => ({ TaskOptionsMenu: () => null }));

const row = { id: 5, projectId: 2, title: "Ship it", project: { id: 2, name: "Atlas", customer: null } };
const listTask = { id: 5, projectId: 2, title: "Ship it", parentTaskId: null };

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tasks/:taskId" element={<TaskPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function mount(path = "/tasks/5") {
  return render(tree(path));
}

afterEach(() => {
  cleanup();
  detailProps.current = null;
  listArgs.current = [];
  document.title = "";
});

describe("TaskPage states", () => {
  it("shows a loading state while the task row loads", () => {
    taskQuery.current = { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
    listQuery.current = { data: undefined, isError: false };
    mount();
    expect(screen.getByTestId("page-loading")).toBeTruthy();
  });

  it("shows one not-found state with a way back on a 404", () => {
    taskQuery.current = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(404, "Not found", null),
      refetch: vi.fn(),
    };
    listQuery.current = { data: undefined, isError: false };
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Task not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Tasks" }).getAttribute("href")).toBe("/tasks");
  });

  it("treats a malformed id as not found without asking the server", () => {
    taskQuery.current = { data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn() };
    listQuery.current = { data: undefined, isError: false };
    mount("/tasks/12abc");
    expect(screen.getByRole("heading", { level: 1, name: "Task not found" })).toBeTruthy();
  });

  it("does not hang on a task the server returned but the project list lacks", () => {
    taskQuery.current = { data: row, isPending: false, isError: false, error: null, refetch: vi.fn() };
    listQuery.current = { data: [], isError: false, refetch: vi.fn() };
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Task not found" })).toBeTruthy();
  });

  it("offers a retry, not not-found, on a server error", () => {
    taskQuery.current = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(500, "boom", null),
      refetch: vi.fn(),
    };
    listQuery.current = { data: undefined, isError: false };
    mount();
    expect(screen.queryByText("Task not found")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("keeps the page up when a background refetch fails and an older row is cached", () => {
    taskQuery.current = {
      data: row,
      isPending: false,
      isError: true,
      error: new ApiError(500, "boom", null),
      refetch: vi.fn(),
    };
    listQuery.current = { data: [listTask], isError: false, refetch: vi.fn() };
    mount();
    expect(screen.getByTestId("detail")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps the page up when a cache-seeded first load fails and the project's list has the task", () => {
    // First render: the placeholder row names the project. Then the fetch fails and the
    // row goes with it; only the remembered project id still reaches the loaded list.
    taskQuery.current = { data: row, isPending: false, isError: false, error: null, refetch: vi.fn() };
    listQuery.current = { data: [listTask], isError: false, refetch: vi.fn() };
    const { rerender } = mount();
    expect(screen.getByTestId("detail")).toBeTruthy();

    taskQuery.current = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(500, "boom", null),
      refetch: vi.fn(),
    };
    rerender(tree("/tasks/5"));
    expect(listArgs.current[listArgs.current.length - 1]).toBe(2);
    expect(screen.getByTestId("detail")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("a 500 on a first load that was never seeded shows Retry", () => {
    taskQuery.current = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(500, "boom", null),
      refetch: vi.fn(),
    };
    listQuery.current = { data: [listTask], isError: false, refetch: vi.fn() };
    mount();
    expect(screen.queryByTestId("detail")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("a 404 still wins over a cached row", () => {
    taskQuery.current = {
      data: row,
      isPending: false,
      isError: true,
      error: new ApiError(404, "Not found", null),
      refetch: vi.fn(),
    };
    listQuery.current = { data: [listTask], isError: false, refetch: vi.fn() };
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Task not found" })).toBeTruthy();
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("rejects ids the server could never hold", () => {
    taskQuery.current = { data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn() };
    listQuery.current = { data: undefined, isError: false };
    mount("/tasks/0");
    expect(screen.getByRole("heading", { level: 1, name: "Task not found" })).toBeTruthy();
    cleanup();
    mount("/tasks/2147483648");
    expect(screen.getByRole("heading", { level: 1, name: "Task not found" })).toBeTruthy();
  });

  it("renders the page layout of TaskDetail for the task's project and sets the document title", () => {
    taskQuery.current = { data: row, isPending: false, isError: false, error: null, refetch: vi.fn() };
    listQuery.current = { data: [listTask], isError: false, refetch: vi.fn() };
    mount();
    expect(screen.getByTestId("detail").getAttribute("data-layout")).toBe("page");
    expect(detailProps.current).toMatchObject({ projectId: 2, taskId: 5 });
    expect(document.title).toBe("Ship it · Solvro");
  });
});
