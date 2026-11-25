// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/lib/queries";

const state: { perms: string[]; userId: number; projects: ProjectSummary[] } = {
  perms: [],
  userId: 1,
  projects: [],
};
const deleteMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: state.userId, permissions: state.perms }, userVerified: true }),
  hasPermission: (u: { permissions: string[] } | null, p: string) =>
    !!u && (u.permissions.includes("*") || u.permissions.includes(p)),
}));
vi.mock("@/lib/queries", () => ({
  useCustomers: () => ({ data: [] }),
  useProjects: () => ({
    data: state.projects,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
  useDeleteProject: () => ({ mutateAsync: deleteMock, isPending: false }),
}));
vi.mock("@/components/ProjectFormModal", () => ({ ProjectFormModal: () => null }));
vi.mock("@/components/reui/filters", () => ({
  Filters: () => null,
  createFilter: () => ({}),
}));

import { Projects } from "./Projects";

function project(id: number, over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id,
    name: `Project ${id}`,
    description: null,
    outlineUrl: null,
    status: "ACTIVE",
    tamId: 1,
    wipLimits: null,
    excludeFromPortfolio: false,
    baselineLockedAt: null,
    baselineLockedById: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    tam: { id: 1, username: "alice" },
    customers: [],
    primaryCustomer: null,
    _count: { tasks: 3 },
    ...over,
  } as ProjectSummary;
}

function show() {
  render(
    <MemoryRouter>
      <Projects />
    </MemoryRouter>,
  );
}

describe("Projects row menu", () => {
  beforeEach(() => {
    state.perms = ["project:write"];
    state.userId = 1;
    state.projects = [project(1), project(2, { tamId: 9, tam: { id: 9, username: "bob" } })];
    deleteMock.mockReset();
    deleteMock.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("shows the menu only on projects the user owns, with project:write", () => {
    show();
    expect(screen.getByRole("button", { name: "Actions for Project 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actions for Project 2" })).toBeNull();
  });

  it("shows no menu without project:write", () => {
    state.perms = [];
    show();
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });

  it("shows the menu on every project for project:view-all", () => {
    state.perms = ["project:write", "project:view-all"];
    show();
    expect(screen.getAllByRole("button", { name: /Actions for/ })).toHaveLength(2);
  });

  it("shows the menu to the owner of a linked customer who is not the TAM", () => {
    state.projects = [
      project(3, {
        tamId: 9,
        tam: { id: 9, username: "bob" },
        customers: [{ id: 5, name: "Acme", tamId: 1, isPrimary: true }],
      }),
    ];
    show();
    expect(screen.getByRole("button", { name: "Actions for Project 3" })).toBeTruthy();
  });

  it("shows no menu to a member when the linked customers have other owners or none", () => {
    state.projects = [
      project(4, {
        tamId: 9,
        tam: { id: 9, username: "bob" },
        customers: [
          { id: 5, name: "Acme", tamId: 7, isPrimary: true },
          { id: 6, name: "Globex", tamId: null, isPrimary: false },
        ],
      }),
    ];
    show();
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });

  it("keeps the menu button out of the project link", () => {
    show();
    const link = screen.getByRole("link", { name: /Project 1/ });
    expect(link.querySelector("button")).toBeNull();
  });

  it("confirms with the task count, then deletes that project", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Project 1" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete project/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain('Delete project "Project 1"');
    expect(dialog.textContent).toContain("3 tasks");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
  });

  it("shows the error when the delete fails", async () => {
    deleteMock.mockRejectedValue(new Error("boom"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Project 1" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete project/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await screen.findByRole("alert");
  });
});
