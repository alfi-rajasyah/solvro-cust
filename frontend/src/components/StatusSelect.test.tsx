// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StatusSelect } from "./StatusSelect";
import { type TaskStatusDef, queryKeys } from "@/lib/queries";

afterEach(cleanup);

const DEFS: TaskStatusDef[] = [
  { id: 3, name: "Done", category: "DONE", color: "emerald", position: 2, isDefault: true },
  { id: 4, name: "QA / UAT", category: "IN_PROGRESS", color: "violet", position: 3, isDefault: false },
  { id: 1, name: "To do", category: "TODO", color: "gray", position: 0, isDefault: true },
  { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", position: 1, isDefault: true },
];

function renderSelect(props: Partial<React.ComponentProps<typeof StatusSelect>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.taskStatuses, DEFS);
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <StatusSelect value={2} onChange={onChange} variant="chip" {...props} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("StatusSelect", () => {
  it("shows the current status name on the trigger", () => {
    renderSelect();
    expect(screen.getByRole("combobox", { name: "Status" }).textContent).toContain("In progress");
  });

  it("opens a list grouped by category, in category then position order", async () => {
    renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const listbox = await screen.findByRole("listbox");
    const groups = within(listbox).getAllByRole("group");
    expect(groups.map((g) => g.textContent?.replace(/^[a-z_]+/, "").split(/(?=To do|In progress|QA|Done)/)[0])).toEqual([
      "Not started",
      "Active",
      "Done",
    ]);
    const names = within(listbox).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["To do", "In progress", "QA / UAT", "Done"]);
  });

  it("reports the picked status def", async () => {
    const onChange = renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const option = await screen.findByRole("option", { name: "QA / UAT" });
    fireEvent.mouseMove(option);
    fireEvent.click(option);
    fireEvent.mouseUp(option);
    fireEvent.pointerUp(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toMatchObject({ id: 4, category: "IN_PROGRESS" });
  });

  it("renders a plain chip, no control, when disabled as a chip", () => {
    renderSelect({ disabled: true });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("In progress")).toBeTruthy();
  });
});
