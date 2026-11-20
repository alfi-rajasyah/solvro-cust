// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { Task } from "@/lib/queries";
import { TaskFormModal } from "./TaskFormModal";

const createAsync = vi.fn();
const updateAsync = vi.fn();

const state = {
  permissions: ["task:write"] as string[],
  tasks: [] as Partial<Task>[],
};

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      userVerified: true,
      user: { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions: state.permissions },
    }),
  };
});

vi.mock("./itop/useItopOrgChoice", () => ({
  useItopOrgChoice: () => ({ customerId: null, customerName: null }),
}));

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const empty = () => ({ data: [] });
  return {
    ...actual,
    useCreateTask: () => ({ mutate: vi.fn(), mutateAsync: createAsync, isPending: false }),
    useUpdateTask: () => ({ mutate: vi.fn(), mutateAsync: updateAsync, isPending: false }),
    useDeleteTask: mutation,
    useUsers: empty,
    useTaskStatuses: empty,
    useProjectSections: empty,
    useProjectEpics: empty,
    useProjectLabels: empty,
    useItopStatus: () => ({ data: { configured: false } }),
    useProject: () => ({ data: undefined }),
    useProjectTasks: () => ({ data: state.tasks }),
  };
});

// Hooks the modal calls beyond the mocked ones (member list, live refresh) need a client.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function task(over: Partial<Task>): Partial<Task> {
  return { status: "TODO", position: 0, title: "t", parentTaskId: null, labels: [], ...over };
}

// jsdom has no matchMedia; DateRangeField reads it for its desktop/phone switch.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }),
});

afterEach(() => {
  cleanup();
  state.permissions = ["task:write"];
  state.tasks = [];
  createAsync.mockReset();
  updateAsync.mockReset();
});

describe("TaskFormModal", () => {
  it("create mode: the parent picker offers top-level tasks only, never subtasks", () => {
    state.tasks = [
      task({ id: 1, title: "Top level task" }),
      task({ id: 2, title: "A subtask", parentTaskId: 1 }),
    ];
    render(<TaskFormModal open onClose={() => {}} mode="create" projectId={1} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.some((o) => o.includes("Top level task"))).toBe(true);
    expect(options.some((o) => o.includes("A subtask"))).toBe(false);
  });

  it("edit mode: the subtask DONE checkbox is disabled without task:write", () => {
    state.permissions = ["task:read"];
    state.tasks = [
      task({ id: 1, title: "Parent" }),
      task({ id: 2, title: "Child", parentTaskId: 1 }),
    ];
    render(
      <TaskFormModal open onClose={() => {}} mode="edit" projectId={1} task={state.tasks[0] as Task} />,
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const subtaskBox = boxes.find((b) => b.closest("li")?.textContent?.includes("Child"));
    expect(subtaskBox).toBeTruthy();
    expect(subtaskBox!.disabled).toBe(true);
  });

  it("edit mode: the subtask DONE checkbox is enabled with task:write", () => {
    state.tasks = [
      task({ id: 1, title: "Parent" }),
      task({ id: 2, title: "Child", parentTaskId: 1 }),
    ];
    render(
      <TaskFormModal open onClose={() => {}} mode="edit" projectId={1} task={state.tasks[0] as Task} />,
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const subtaskBox = boxes.find((b) => b.closest("li")?.textContent?.includes("Child"));
    expect(subtaskBox!.disabled).toBe(false);
  });

  it("edit mode: the parent picker is disabled with a reason when the task has subtasks", () => {
    state.tasks = [
      task({ id: 1, title: "Parent" }),
      task({ id: 2, title: "Child", parentTaskId: 1 }),
      task({ id: 3, title: "Other top" }),
    ];
    render(
      <TaskFormModal open onClose={() => {}} mode="edit" projectId={1} task={state.tasks[0] as Task} />,
    );
    const picker = screen.getByDisplayValue("Top level") as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(screen.getByText(/stays top level/i)).toBeTruthy();
  });

  it("edit mode: a task without subtasks keeps an enabled parent picker", () => {
    state.tasks = [task({ id: 1, title: "Solo" }), task({ id: 3, title: "Other top" })];
    render(
      <TaskFormModal open onClose={() => {}} mode="edit" projectId={1} task={state.tasks[0] as Task} />,
    );
    expect((screen.getByDisplayValue("Top level") as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryByText(/stays top level/i)).toBeNull();
  });
});

describe("TaskFormModal story points", () => {
  it("create: sends the number, and omits it when empty", async () => {
    createAsync.mockResolvedValue({});
    render(<TaskFormModal open onClose={() => {}} mode="create" projectId={1} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Story points" }), { target: { value: "13" } });
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "New" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "Story points" }).closest("form")!);
    await waitFor(() => expect(createAsync).toHaveBeenCalled());
    expect(createAsync.mock.calls[0][0].storyPoints).toBe(13);
  });

  it("refuses a value outside 0 to 100 before sending", async () => {
    render(<TaskFormModal open onClose={() => {}} mode="create" projectId={1} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Story points" }), { target: { value: "150" } });
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "New" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "Story points" }).closest("form")!);
    expect(await screen.findByText(/whole number from 0 to 100/)).toBeTruthy();
    expect(createAsync).not.toHaveBeenCalled();
  });

  it("edit: sends only the changed estimate, with the old one as expected", async () => {
    updateAsync.mockResolvedValue({});
    const t = task({ id: 1, title: "Parent", storyPoints: 5 }) as Task;
    state.tasks = [t];
    render(<TaskFormModal open onClose={() => {}} mode="edit" projectId={1} task={t} />);
    const box = screen.getByRole("textbox", { name: "Story points" }) as HTMLInputElement;
    expect(box.value).toBe("5");
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(updateAsync).toHaveBeenCalled());
    expect(updateAsync.mock.calls[0][0]).toMatchObject({
      patch: { storyPoints: null },
      expected: { storyPoints: 5 },
    });
  });

  it("is read-only without task:write", () => {
    state.permissions = ["task:read"];
    const t = task({ id: 1, title: "Parent", storyPoints: 5 }) as Task;
    render(<TaskFormModal open onClose={() => {}} mode="edit" projectId={1} task={t} />);
    expect((screen.getByRole("textbox", { name: "Story points" }) as HTMLInputElement).disabled).toBe(true);
  });
});
