// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { TaskOptionsMenu } from "./TaskOptionsMenu";

const refetch = vi.fn();
const deleteMutateAsync = vi.fn();
const duplicateMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const authPerms = { current: ["task:write"] as string[] };
const tasksQuery = { current: {} as Record<string, unknown> };
const usersQuery = { current: undefined as unknown };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      userVerified: true,
      user: { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions: authPerms.current },
    }),
  };
});
vi.mock("@/components/itop/useItopOrgChoice", () => ({
  useItopOrgChoice: () => ({ customerId: null, customerName: null }),
}));
vi.mock("@/components/itop/useCanCreateItopTicket", () => ({
  useCanCreateItopTicket: () => ({ allowed: false }),
}));

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const empty = () => ({ data: undefined, isLoading: false });
  return {
    ...actual,
    useProjectTasks: () => tasksQuery.current,
    useProject: empty,
    useItopStatus: () => ({ data: { configured: false } }),
    useItopTicketsByRefs: empty,
    useProjectSections: empty,
    useProjectEpics: empty,
    useUsers: () => ({ data: usersQuery.current, isLoading: false }),
    useTaskStatuses: empty,
    useProjectLabels: empty,
    useProjectMembers: empty,
    useProjectTeamAccess: empty,
    useComments: empty,
    useAddComment: mutation,
    useCreateTask: mutation,
    useUpdateTask: () => ({ mutate: vi.fn(), mutateAsync: updateMutateAsync, isPending: false }),
    useDeleteTask: () => ({ mutate: vi.fn(), mutateAsync: deleteMutateAsync, isPending: false }),
    useDuplicateTask: () => ({ mutate: vi.fn(), mutateAsync: duplicateMutateAsync, isPending: false }),
  };
});

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

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const task = {
  id: 5,
  title: "Parent",
  description: "Some words",
  status: "TODO",
  priority: "MEDIUM",
  position: 0,
  parentTaskId: null,
  labels: [],
  section: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  duplicateMutateAsync.mockReset();
  deleteMutateAsync.mockReset();
});

function mount(overrides: Partial<React.ComponentProps<typeof TaskOptionsMenu>> = {}) {
  tasksQuery.current = { data: [task, { ...task, id: 6, parentTaskId: 5, title: "Child" }], isError: false, error: null, refetch };
  const props = {
    projectId: 1,
    task: task as never,
    canEdit: true,
    onDuplicated: vi.fn(),
    onDeleted: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  render(<TaskOptionsMenu {...props} />);
  return props;
}

describe("TaskOptionsMenu", () => {
  it("lists Duplicate task and Delete task under the Task options button", () => {
    mount();
    expect(screen.queryByRole("button", { name: /Duplicate task/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    expect(screen.getByRole("button", { name: /Duplicate task/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Delete task/ })).toBeTruthy();
  });

  it("duplicates and reports the copy id", async () => {
    duplicateMutateAsync.mockResolvedValue({ id: 99 });
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    fireEvent.click(screen.getByRole("button", { name: /Duplicate task/ }));
    await waitFor(() => expect(p.onDuplicated).toHaveBeenCalledWith(99));
    expect(p.onError).toHaveBeenCalledWith(null);
  });

  it("reports a failed duplicate", async () => {
    duplicateMutateAsync.mockRejectedValue(new Error("nope"));
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    fireEvent.click(screen.getByRole("button", { name: /Duplicate task/ }));
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith("Could not duplicate the task."));
  });

  it("asks before deleting and names the subtask count", () => {
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete task/ }));
    expect(screen.getByText(/This task has 1 subtask\(s\)/)).toBeTruthy();
    expect(p.onDeleted).not.toHaveBeenCalled();
  });

  it("disables both actions without edit permission", () => {
    mount({ canEdit: false });
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    expect((screen.getByRole("button", { name: /Duplicate task/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Delete task/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
