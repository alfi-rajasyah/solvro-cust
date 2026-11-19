// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SectionReorderModal } from "./SectionReorderModal";

const state = { permissions: ["project:write"] as string[], onDragStart: undefined as undefined | (() => void) };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      user: { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions: state.permissions },
    }),
  };
});

vi.mock("@/lib/queries", () => ({
  useProjectSections: () => ({
    data: [{ id: 1, name: "Alpha", color: "#000", position: 0 }],
  }),
  useUpdateSection: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/reui/sortable", () => ({
  Sortable: (p: { onDragStart?: () => void; children: React.ReactNode }) => {
    state.onDragStart = p.onDragStart;
    return <div>{p.children}</div>;
  },
  SortableItem: (p: { children: React.ReactNode }) => <div>{p.children}</div>,
  SortableItemHandle: (p: { children: React.ReactNode }) => <span>{p.children}</span>,
}));

afterEach(() => {
  cleanup();
  state.permissions = ["project:write"];
});

describe("SectionReorderModal", () => {
  it("renders a read-only note without project:write", () => {
    state.permissions = ["project:read"];
    render(<SectionReorderModal projectId={1} open onClose={() => {}} />);
    expect(screen.getByText(/need permission/i)).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("lists sections with project:write", () => {
    render(<SectionReorderModal projectId={1} open onClose={() => {}} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("the header X closes even when a drag never ended; Escape does not", () => {
    const onClose = vi.fn();
    render(<SectionReorderModal projectId={1} open onClose={onClose} />);
    state.onDragStart?.();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
