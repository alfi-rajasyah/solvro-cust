// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { ProjectList } from "./ProjectList";

const state = { permissions: [] as string[], tasks: [] as unknown[] };

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

vi.mock("../ProjectDetail", () => ({
  useProjectContext: () => ({ project: { id: 1, name: "P", customers: [] } }),
}));

vi.mock("@/components/itop/useItopOrgChoice", () => ({
  useItopOrgChoice: () => ({
    customerId: null,
    customerName: null,
    organisations: [],
    organisationLabel: null,
  }),
}));
vi.mock("@/components/itop/useCanCreateItopTicket", () => ({
  useCanCreateItopTicket: () => ({ allowed: false }),
}));

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  const section = (id: number, name: string) => ({ id, name, position: id, projectId: 1 });
  return {
    ...actual,
    useProjectTasks: () => ({ data: state.tasks, isLoading: false, isError: false, error: null }),
    useProjectSections: () => ({
      data: [section(1, "Alpha"), section(2, "Beta")],
      isLoading: false,
    }),
    useProjectEpics: () => ({ data: [] }),
    useUsers: () => ({ data: [] }),
    useItopStatus: () => ({ data: { configured: false } }),
    useItopTicketsByRefs: () => ({ data: undefined }),
    useUpdateTask: mutation,
    useCreateSection: mutation,
    useUpdateSection: mutation,
    useDeleteSection: mutation,
    useDuplicateSection: mutation,
  };
});

// jsdom has no matchMedia (some child pickers read it).
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
  return rtlRender(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.permissions = [];
  state.tasks = [];
});

describe("ProjectList section actions", () => {
  it("task:write alone keeps task actions but hides section management", () => {
    state.permissions = ["task:write"];
    render(<ProjectList />);
    expect(screen.getAllByRole("button", { name: /Add task/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Add section/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reorder sections/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate section" })).toBeNull();
    expect(screen.queryByTitle("Rename section")).toBeNull();
    expect(screen.queryByTitle("Delete section")).toBeNull();
  });

  it("project:write shows add, reorder, rename, duplicate and delete", () => {
    state.permissions = ["task:write", "project:write"];
    render(<ProjectList />);
    expect(screen.getByRole("button", { name: /Add section/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reorder sections/ })).toBeTruthy();
    expect(screen.getAllByTitle("Rename section").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Duplicate section" }).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete section").length).toBeGreaterThan(0);
  });

  it("section dots use the Gantt's resolved color, not legacy slate", () => {
    const { container } = render(<ProjectList />);
    const dots = Array.from(container.querySelectorAll<HTMLElement>("span.h-2.w-2.rounded-full"));
    expect(dots.length).toBe(2);
    // Mocked sections carry no color, so the Gantt fallback presets apply.
    expect(dots[0].style.backgroundColor).not.toBe("");
    expect(dots[0].style.backgroundColor).not.toBe("rgb(148, 163, 184)");
    expect(dots[0].style.backgroundColor).not.toBe(dots[1].style.backgroundColor);
  });
});

describe("ProjectList description preview", () => {
  const base = {
    projectId: 1,
    sectionId: 1,
    status: "TODO",
    statusId: null,
    statusDef: null,
    priority: "MEDIUM",
    position: 1,
    labels: [],
    epicId: null,
    assignedToId: null,
    assignedTo: null,
    startDate: null,
    dueDate: null,
    isCriticalPath: false,
    storyPoints: null,
  };

  it("shows one preview line for tasks and subtasks that have a description", () => {
    state.tasks = [
      { ...base, id: 1, title: "Parent", parentTaskId: null, description: "Line one\nline two" },
      { ...base, id: 2, title: "Child", parentTaskId: 1, position: 2, description: "Sub notes" },
      { ...base, id: 3, title: "Bare", parentTaskId: null, position: 3, description: null },
    ];
    const { container } = render(<ProjectList />);
    const texts = Array.from(container.querySelectorAll("[data-testid=list-description-preview]")).map(
      (el) => el.textContent,
    );
    expect(texts).toContain("Line one\nline two");
    // Bare has none: its title is not followed by a preview.
    expect(texts.filter((t) => t === null || t === "")).toHaveLength(0);
    expect(container.querySelector("[data-testid=list-description-preview]")?.className).toContain("truncate");
  });

  it("renders no preview for a blank description", () => {
    state.tasks = [{ ...base, id: 1, title: "Blank", parentTaskId: null, description: "   " }];
    const { container } = render(<ProjectList />);
    expect(container.querySelector("[data-testid=list-description-preview]")).toBeNull();
  });
});
