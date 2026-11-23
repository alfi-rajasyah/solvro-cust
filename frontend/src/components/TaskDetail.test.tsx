// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { TaskDetail } from "./TaskDetail";

const refetch = vi.fn();
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
  refetch.mockReset();
  duplicateMutateAsync.mockReset();
  updateMutateAsync.mockReset();
});

function mountPage() {
  tasksQuery.current = { data: [task], isError: false, error: null, refetch };
  return render(<TaskDetail projectId={1} taskId={5} layout="page" onOpenTask={() => {}} />);
}

describe("TaskDetail page layout", () => {
  it("renders the fields in a labelled side region and the content outside it", () => {
    mountPage();
    const side = screen.getByRole("complementary", { name: "Task fields" });
    for (const label of ["Assignee", "Dates", "Priority", "Story points", "Section", "Epic", "Labels"]) {
      expect(within(side).getByText(label)).toBeTruthy();
    }
    expect(within(side).queryByText("Comments", { exact: false })).toBeNull();
    const title = screen.getByRole("button", { name: "Parent" });
    expect(side.contains(title)).toBe(false);
    expect(side.contains(screen.getByText("Subtasks"))).toBe(false);
    expect(side.contains(screen.getByRole("heading", { name: /Comments/ }))).toBe(false);
  });

  it("keeps DOM order equal to reading order: title, description, fields, subtasks, comments", () => {
    mountPage();
    const side = screen.getByRole("complementary", { name: "Task fields" });
    const title = screen.getByRole("button", { name: "Parent" });
    const description = screen.getByRole("button", { name: "Edit description" });
    const subtasks = screen.getByText("Subtasks");
    const comments = screen.getByRole("heading", { name: /Comments/ });
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(title, description)).toBe(true);
    expect(follows(description, side)).toBe(true);
    expect(follows(side, subtasks)).toBe(true);
    expect(follows(subtasks, comments)).toBe(true);
  });

  it("is one column below md and two from md up", () => {
    mountPage();
    const grid = screen.getByRole("complementary", { name: "Task fields" }).parentElement!;
    expect(grid.className).toContain("md:grid-cols-");
    expect(grid.className.split(" ").some((c) => c.startsWith("grid-cols-"))).toBe(false);
  });

  it("calls renderHeader with the task and keeps the panel layout free of the page aside", () => {
    tasksQuery.current = { data: [task], isError: false, error: null, refetch };
    render(
      <TaskDetail
        projectId={1}
        taskId={5}
        layout="panel"
        onOpenTask={() => {}}
        renderHeader={({ task: t }) => <div data-testid="hdr">{t.title}</div>}
      />,
    );
    expect(screen.getByTestId("hdr").textContent).toBe("Parent");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renders nothing while the task is not in the list", () => {
    tasksQuery.current = { data: [], isError: false, error: null, refetch };
    const { container } = render(<TaskDetail projectId={1} taskId={5} layout="page" onOpenTask={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
