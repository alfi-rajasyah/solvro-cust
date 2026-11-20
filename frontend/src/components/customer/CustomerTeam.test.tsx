// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { CustomerTeam } from "./CustomerTeam";

const team = { current: { members: [], canManage: false } as unknown };
const addMutateAsync = vi.fn();
const removeMutateAsync = vi.fn();

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      userVerified: true,
      user: { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions: [] },
    }),
  };
});
vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  return {
    ...actual,
    useCustomerTeam: () => ({ data: team.current, isLoading: false, isError: false }),
    useUsers: () => ({
      data: [
        { id: 1, username: "ann", email: "ann@x.pl", role: "TAM", active: true, avatarUrl: null },
        { id: 2, username: "bob", email: "bob@x.pl", role: "TAM", active: true, avatarUrl: null },
        { id: 3, username: "cat", email: "cat@x.pl", role: "TAM", active: false, avatarUrl: null },
        { id: 4, username: "dan", email: "dan@x.pl", role: "TAM", active: true, avatarUrl: null },
      ],
    }),
    useAddCustomerTeamMember: () => ({ mutateAsync: addMutateAsync, isPending: false }),
    useRemoveCustomerTeamMember: () => ({
      mutateAsync: removeMutateAsync,
      isPending: false,
      variables: undefined,
    }),
  };
});

const member = (userId: number, username: string, active = true) => ({
  userId,
  username,
  email: `${username}@x.pl`,
  active,
  addedAt: "2026-11-01T10:00:00.000Z",
  addedBy: { id: 9, username: "admin" },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CustomerTeam", () => {
  it("shows members read-only when canManage is false", () => {
    team.current = { members: [member(2, "bob", false)], canManage: false };
    render(<CustomerTeam customerId={5} />);
    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.getByText(/Added by admin/)).toBeTruthy();
    expect(screen.queryByLabelText("Person to add")).toBeNull();
    expect(screen.queryByLabelText("Remove bob")).toBeNull();
  });

  it("shows the empty state", () => {
    team.current = { members: [], canManage: true };
    render(<CustomerTeam customerId={5} />);
    expect(screen.getByTestId("customer-team-empty")).toBeTruthy();
  });

  it("offers only active non-members and adds the picked person", async () => {
    team.current = { members: [member(2, "bob")], canManage: true };
    addMutateAsync.mockResolvedValue({});
    render(<CustomerTeam customerId={5} />);
    const select = screen.getByLabelText("Person to add") as HTMLSelectElement;
    const names = Array.from(select.options).map((o) => o.textContent);
    expect(names.some((n) => n?.includes("bob"))).toBe(false);
    expect(names.some((n) => n?.includes("cat"))).toBe(false);
    expect(names.some((n) => n?.includes("dan"))).toBe(true);
    fireEvent.change(select, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledWith(4));
  });

  it("asks for confirmation before removing", async () => {
    team.current = { members: [member(2, "bob")], canManage: true };
    removeMutateAsync.mockResolvedValue(undefined);
    render(<CustomerTeam customerId={5} />);
    fireEvent.click(screen.getByLabelText("Remove bob"));
    expect(removeMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from team" }).at(-1)!);
    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalledWith(2));
  });

  it("shows a plain message for a server error", async () => {
    team.current = { members: [], canManage: true };
    addMutateAsync.mockRejectedValue(new ApiError(400, "Cannot add an inactive user", { code: "user_inactive" }));
    render(<CustomerTeam customerId={5} />);
    fireEvent.change(screen.getByLabelText("Person to add"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("That user is inactive and can't be added.")).toBeTruthy();
  });
});
