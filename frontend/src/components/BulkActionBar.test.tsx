// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BULK_EPIC_SUBTASK_REASON, BULK_TASK_LIMIT, BulkActionBar } from "./BulkActionBar";
import { queryKeys, type Epic, type Label, type UserSummary } from "@/lib/queries";

afterEach(cleanup);

const LABELS: Label[] = [
  { id: 1, projectId: 5, name: "Bug", color: "#ef4444" },
  { id: 2, projectId: 5, name: "UX", color: "#0058be" },
];
const EPICS = [{ id: 7, title: "Checkout" }] as Epic[];
const USERS = [
  { id: 1, username: "ana", active: true },
  { id: 2, username: "bob-left", active: false },
] as UserSummary[];

function renderBar(props: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  qc.setQueryData(queryKeys.taskStatuses, []);
  const onApply = vi.fn();
  const onClear = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <BulkActionBar
        projectId={5}
        count={3}
        hasSubtask={false}
        labels={LABELS}
        epics={EPICS}
        users={USERS}
        pending={false}
        error={null}
        onApply={onApply}
        onClear={onClear}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onApply, onClear };
}

describe("BulkActionBar", () => {
  it("shows the count and the six actions", () => {
    renderBar();
    expect(screen.getByText("3 selected")).toBeTruthy();
    for (const name of ["Add label", "Remove label", "Set status", "Set assignee", "Set priority", "Set epic"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("disables Set epic and says why when a subtask is selected", () => {
    renderBar({ hasSubtask: true });
    const epic = screen.getByRole("button", { name: "Set epic" }) as HTMLButtonElement;
    expect(epic.disabled).toBe(true);
    expect(screen.getByText(BULK_EPIC_SUBTASK_REASON)).toBeTruthy();
  });

  it("applies the chosen labels in one add request", () => {
    const { onApply } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));
    const apply = screen.getByRole("button", { name: /^Add to 3 tasks$/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Bug" }));
    fireEvent.click(screen.getByRole("button", { name: "UX" }));
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith({ addLabelIds: [1, 2] });
  });

  it("sends removeLabelIds for Remove label", () => {
    const { onApply } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Remove label" }));
    fireEvent.click(screen.getByRole("button", { name: "UX" }));
    fireEvent.click(screen.getByRole("button", { name: /^Remove from 3 tasks$/ }));
    expect(onApply).toHaveBeenCalledWith({ removeLabelIds: [2] });
  });

  it("hides inactive users from the assignee picker and can unassign", () => {
    const { onApply } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Set assignee" }));
    expect(screen.queryByRole("button", { name: /bob-left/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ana/ }));
    expect(onApply).toHaveBeenCalledWith({ assignedToId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(onApply).toHaveBeenCalledWith({ assignedToId: null });
  });

  it("sets priority and epic", () => {
    const { onApply } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Set priority" }));
    fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
    expect(onApply).toHaveBeenCalledWith({ priority: "URGENT" });
    fireEvent.click(screen.getByRole("button", { name: "Set epic" }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(onApply).toHaveBeenCalledWith({ epicId: 7 });
    fireEvent.click(screen.getByRole("button", { name: "No epic" }));
    expect(onApply).toHaveBeenCalledWith({ epicId: null });
  });

  it("disables every action and says why above the 200 task cap", () => {
    renderBar({ count: BULK_TASK_LIMIT + 1 });
    for (const name of ["Add label", "Remove label", "Set status", "Set assignee", "Set priority", "Set epic"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText("Select at most 200 tasks for a bulk edit (201 selected).")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps actions enabled at exactly the cap", () => {
    renderBar({ count: BULK_TASK_LIMIT });
    expect((screen.getByRole("button", { name: "Add label" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server error and calls onClear from Clear", () => {
    const { onClear } = renderBar({ error: "One of the tasks is not in this project." });
    expect(screen.getByText("One of the tasks is not in this project.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
  });
});
