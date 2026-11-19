// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { TaskPanel } from "./TaskPanel";

const refetch = vi.fn();
const duplicateMutateAsync = vi.fn();
const tasksQuery = { current: {} as Record<string, unknown> };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      userVerified: true,
      user: { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions: ["task:write"] },
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
    useUsers: empty,
    useTaskStatuses: empty,
    useProjectLabels: empty,
    useProjectMembers: empty,
    useComments: empty,
    useAddComment: mutation,
    useCreateTask: mutation,
    useUpdateTask: mutation,
    useDeleteTask: mutation,
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

const props = { projectId: 1, taskId: 5, onOpenTask: () => {}, onClose: () => {} };

afterEach(() => {
  cleanup();
  refetch.mockReset();
  duplicateMutateAsync.mockReset();
});

describe("TaskPanel load states", () => {
  it("shows an error with Retry, not an endless spinner, when the task list fails to load", () => {
    tasksQuery.current = { data: undefined, isError: true, error: new Error("boom"), refetch };
    render(<TaskPanel {...props} />);
    expect(screen.queryByText("Loading task…")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Could not load this task: boom");
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("still shows Loading while the fetch is in flight", () => {
    tasksQuery.current = { data: undefined, isError: false, error: null, refetch };
    render(<TaskPanel {...props} />);
    expect(screen.getByText("Loading task…")).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  });
});

describe("TaskPanel action errors", () => {
  it("renders a failed Duplicate at the top of the scroll area and scrolls it into view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    duplicateMutateAsync.mockRejectedValue(new Error("nope"));
    const task = {
      id: 5,
      title: "Parent",
      status: "TODO",
      priority: "MEDIUM",
      position: 0,
      parentTaskId: null,
      labels: [],
      section: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    tasksQuery.current = { data: [task], isError: false, error: null, refetch };
    render(<TaskPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    fireEvent.click(screen.getByRole("button", { name: /Duplicate task/ }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not duplicate the task.");
    // First element of the scroll container, above the subtasks list.
    const wrapper = alert.parentElement!;
    expect(wrapper.parentElement?.className).toContain("overflow-y-auto");
    expect(wrapper.parentElement?.firstElementChild).toBe(wrapper);
  });
});
