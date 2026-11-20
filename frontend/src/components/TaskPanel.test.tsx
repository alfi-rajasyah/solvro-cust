// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { TaskPanel } from "./TaskPanel";

const refetch = vi.fn();
const duplicateMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const authPerms = { current: ["task:write"] as string[] };
const tasksQuery = { current: {} as Record<string, unknown> };

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
    useUsers: empty,
    useTaskStatuses: empty,
    useProjectLabels: empty,
    useProjectMembers: empty,
    useComments: empty,
    useAddComment: mutation,
    useCreateTask: mutation,
    useUpdateTask: () => ({ mutate: vi.fn(), mutateAsync: updateMutateAsync, isPending: false }),
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
  updateMutateAsync.mockReset();
  authPerms.current = ["task:write"];
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

describe("TaskPanel hook order", () => {
  it("renders loading first and then the loaded task without a hook-order error", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    tasksQuery.current = { data: undefined, isError: false, error: null, refetch };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const ui = () => (
      <QueryClientProvider client={client}>
        <TaskPanel {...props} />
      </QueryClientProvider>
    );
    const { rerender } = rtlRender(ui());
    expect(screen.getByText("Loading task…")).toBeTruthy();
    tasksQuery.current = {
      data: [
        {
          id: 5,
          title: "Parent",
          description: null,
          status: "TODO",
          priority: "MEDIUM",
          position: 0,
          parentTaskId: null,
          labels: [],
          section: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      isError: false,
      error: null,
      refetch,
    };
    expect(() => rerender(ui())).not.toThrow();
    expect(screen.getByRole("button", { name: "Add a description" })).toBeTruthy();
    const hookErrors = err.mock.calls.filter((c) => /hooks/i.test(String(c[0])));
    expect(hookErrors).toEqual([]);
    err.mockRestore();
  });
});

describe("TaskPanel description", () => {
  const base = {
    id: 5,
    title: "Parent",
    description: "Line one\nLine two",
    status: "TODO",
    priority: "MEDIUM",
    position: 0,
    parentTaskId: null,
    labels: [],
    section: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  function open(over: Record<string, unknown> = {}) {
    tasksQuery.current = { data: [{ ...base, ...over }], isError: false, error: null, refetch };
    updateMutateAsync.mockResolvedValue({});
    render(<TaskPanel {...props} />);
  }

  it("shows the description with its line breaks", () => {
    open();
    const el = screen.getByText(/Line one/);
    expect(el.textContent).toBe("Line one\nLine two");
    expect(el.className).toContain("whitespace-pre-wrap");
  });

  it("saves an edit on blur through the stale-write check", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    const box = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(box, { target: { value: "New text\nsecond" } });
    fireEvent.blur(box);
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync.mock.calls[0][0]).toMatchObject({
      id: 5,
      patch: { description: "New text\nsecond" },
      expected: { description: "Line one\nLine two" },
    });
  });

  it("saves null when the text is cleared", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    const box = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(box, { target: { value: "  " } });
    fireEvent.blur(box);
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({ description: null });
  });

  it("does not save an unchanged description", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Description" }));
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("Escape cancels without saving and does not close the panel", () => {
    const onClose = vi.fn();
    tasksQuery.current = { data: [base], isError: false, error: null, refetch };
    render(<TaskPanel {...props} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    const box = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(box, { target: { value: "discard me" } });
    // One batch: the textarea is still mounted when the blur lands, as when a
    // browser blurs the field while it is being removed.
    act(() => {
      fireEvent.keyDown(box, { key: "Escape" });
      fireEvent.blur(box);
    });
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Line one/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit description" }));
  });

  it("Ctrl+Enter saves", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    const box = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(box, { target: { value: "via keys" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.blur(box);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit description" }));
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({ description: "via keys" });
  });

  it("drops the draft when the panel moves to another task mid-edit", () => {
    const other = { ...base, id: 6, title: "Other", description: "Other text" };
    tasksQuery.current = { data: [base, other], isError: false, error: null, refetch };
    const { rerender } = render(<TaskPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit description" }));
    const box = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(box, { target: { value: "half typed" } });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TaskPanel {...props} taskId={6} />
      </QueryClientProvider>,
    );
    fireEvent.blur(box);
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("shows an Add a description placeholder to editors when empty", () => {
    open({ description: null });
    expect(screen.getByRole("button", { name: "Add a description" })).toBeTruthy();
  });

  it("is read-only without task:write, and shows nothing when empty", () => {
    authPerms.current = [];
    open();
    const el = screen.getByText(/Line one/);
    expect(el.tagName).toBe("P");
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit description" })).toBeNull();
    cleanup();
    open({ description: null });
    expect(screen.queryByText("Add a description")).toBeNull();
    expect(screen.queryByText("Description")).toBeNull();
  });
});

describe("TaskPanel story points", () => {
  const base = {
    id: 5,
    title: "Parent",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    position: 0,
    parentTaskId: null,
    labels: [],
    section: null,
    storyPoints: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  function open(over: Record<string, unknown> = {}) {
    tasksQuery.current = { data: [{ ...base, ...over }], isError: false, error: null, refetch };
    updateMutateAsync.mockResolvedValue({});
    render(<TaskPanel {...props} />);
  }
  function edit(value: string) {
    fireEvent.click(screen.getByRole("button", { name: "Story points 3" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Story points" }), { target: { value } });
    return screen.getByRole("textbox", { name: "Story points" });
  }

  it("saves a new value on Enter with the stale-write expectation", () => {
    open();
    fireEvent.keyDown(edit("8"), { key: "Enter" });
    expect(updateMutateAsync.mock.calls[0][0]).toMatchObject({
      id: 5,
      patch: { storyPoints: 8 },
      expected: { storyPoints: 3 },
    });
  });

  it("clears the estimate with an empty field", () => {
    open();
    fireEvent.keyDown(edit(""), { key: "Enter" });
    expect(updateMutateAsync.mock.calls[0][0].patch).toEqual({ storyPoints: null });
  });

  it("refuses an out-of-range value and keeps the field open", () => {
    open();
    fireEvent.keyDown(edit("101"), { key: "Enter" });
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("0 to 100");
  });

  it("blur with an invalid draft keeps the field open and shows the problem", () => {
    open();
    fireEvent.blur(edit("abc"));
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Story points" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("0 to 100");
  });

  it("does not save an unchanged value", () => {
    open();
    fireEvent.blur(edit("3"));
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it("Escape cancels without saving", () => {
    open();
    fireEvent.keyDown(edit("9"), { key: "Escape" });
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Story points" })).toBeNull();
  });

  it("shows Not estimated, read-only without task:write", () => {
    authPerms.current = [];
    open({ storyPoints: null });
    const b = screen.getByRole("button", { name: "Story points Not estimated" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });
});
