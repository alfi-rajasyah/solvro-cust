// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from "react-router";
import { useTasksChipFilters } from "./useTasksChipFilters";

type Q<T> = { isSuccess: boolean; isFetching: boolean; data?: T[] };
const ok = <T,>(data: T[]): Q<T> => ({ isSuccess: true, isFetching: false, data });
const lists = {
  users: ok([{ id: 7, username: "ann" }]),
  customers: ok([{ id: 12, name: "Acme" }]),
  statuses: ok([
    { id: 1, name: "To do", category: "TODO", color: "gray", position: 0, isDefault: true },
    { id: 2, name: "In progress", category: "IN_PROGRESS", color: "primary", position: 1, isDefault: true },
    { id: 3, name: "Done", category: "DONE", color: "emerald", position: 2, isDefault: true },
  ]) as Q<unknown>,
  labels: ok([
    { name: "Blocked", projectCount: 1 },
    { name: "Bug", projectCount: 2 },
  ]),
};
let state = { ...lists };

vi.mock("@/lib/queries", () => ({
  useUsers: () => state.users,
  useCustomers: () => state.customers,
  useTaskStatuses: () => state.statuses,
  useLabelNames: () => state.labels,
}));

function setup(search: string, canReadCustomers = true) {
  const seen: { search: string; type: string }[] = [];
  const nav: { go: (to: string) => void } = { go: () => {} };
  function Probe() {
    nav.go = useNavigate();
    const loc = useLocation();
    const type = useNavigationType();
    seen.push({ search: loc.search, type });
    return null;
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/tasks${search}`]}>
      <Probe />
      {children}
    </MemoryRouter>
  );
  const hook = renderHook(() => useTasksChipFilters({ canRead: true, canReadCustomers }), { wrapper });
  return { seen, hook, nav };
}

const last = (seen: { search: string }[]) => new URLSearchParams(seen[seen.length - 1].search);

describe("useTasksChipFilters", () => {
  beforeEach(() => {
    state = { ...lists };
  });

  it("restores every chip from the URL", () => {
    const { hook } = setup("?status=id:2&priority=HIGH&assignee=7&customer=12&label=Bug&label=Blocked&view=all");
    expect(hook.result.current.values).toEqual({
      status: ["id:2"],
      priority: ["HIGH"],
      assignedToId: ["7"],
      customerId: ["12"],
      label: ["Bug", "Blocked"],
    });
    expect(hook.result.current.chips.map((c) => c.field)).toEqual([
      "status",
      "priority",
      "assignedToId",
      "customerId",
      "label",
    ]);
  });

  it("writes a pick to the URL with a replace navigation and keeps other params", async () => {
    const { seen, hook } = setup("?view=overdue&assigneeId=9");
    act(() =>
      hook.result.current.onChange([{ id: "x", field: "priority", operator: "is", values: ["URGENT"] }]),
    );
    await waitFor(() => expect(hook.result.current.values.priority).toEqual(["URGENT"]));
    expect(seen[seen.length - 1].type).toBe("REPLACE");
    const p = last(seen);
    expect(p.get("priority")).toBe("URGENT");
    expect(p.get("view")).toBe("overdue");
    expect(p.get("assigneeId")).toBe("9");
  });

  it("keeps an empty just-added chip until a value is picked", () => {
    const { hook } = setup("");
    act(() => hook.result.current.onChange([{ id: "x", field: "status", operator: "is", values: [] }]));
    expect(hook.result.current.chips).toHaveLength(1);
    expect(hook.result.current.values.status).toEqual([]);
  });

  it("clearing the chips and the URL empties both (Reset)", async () => {
    const { hook } = setup("?priority=LOW");
    expect(hook.result.current.chips).toHaveLength(1);
    act(() => hook.result.current.clearChips());
    expect(hook.result.current.chips).toEqual([]);
  });

  it("drops unknown ids and names once their lists are fresh, with a replace navigation", async () => {
    const { seen, hook } = setup("?status=id:99&priority=LOW&assignee=4&customer=5&label=Gone&label=bug");
    await waitFor(() => expect(hook.result.current.values.assignedToId).toEqual([]));
    const v = hook.result.current.values;
    expect(v.status).toEqual([]);
    expect(v.customerId).toEqual([]);
    expect(v.label).toEqual(["Bug"]);
    expect(v.priority).toEqual(["LOW"]);
    expect(seen[seen.length - 1].type).toBe("REPLACE");
    expect(hook.result.current.chips.map((c) => c.field)).toEqual(["priority", "label"]);
  });

  it("does not prune a list that is loading, refetching or failed", async () => {
    for (const bad of [
      { isSuccess: false, isFetching: true },
      { isSuccess: true, isFetching: true, data: [] },
      { isSuccess: false, isFetching: false },
    ]) {
      state = { users: bad, customers: bad, statuses: bad, labels: bad } as typeof state;
      const { seen } = setup("?status=id:99&assignee=4&customer=5&label=Gone");
      await new Promise((r) => setTimeout(r, 0));
      expect(seen[seen.length - 1].search).toBe("?status=id:99&assignee=4&customer=5&label=Gone");
    }
  });

  it("rebuilds the chips on an outside URL change, keeping each chip's id and place", async () => {
    const { hook, nav } = setup("?priority=LOW&label=Bug");
    const before = hook.result.current.chips;
    const ids = before.map((c) => c.id);
    expect(before.map((c) => c.field)).toEqual(["priority", "label"]);
    act(() => nav.go("/tasks?priority=HIGH&label=Blocked&label=Bug"));
    await waitFor(() => expect(hook.result.current.values.priority).toEqual(["HIGH"]));
    const after = hook.result.current.chips;
    expect(after.map((c) => [c.id, c.field, c.values])).toEqual([
      [ids[0], "priority", ["HIGH"]],
      [ids[1], "label", ["Blocked", "Bug"]],
    ]);
    act(() => nav.go("/tasks"));
    await waitFor(() => expect(hook.result.current.chips).toEqual([]));
  });

  it("removing the Label chip clears ?label= and keeps the rest", async () => {
    const { seen, hook } = setup("?priority=LOW&label=Bug&label=Blocked&view=all");
    const rest = hook.result.current.chips.filter((c) => c.field !== "label");
    act(() => hook.result.current.onChange(rest));
    await waitFor(() => expect(hook.result.current.values.label).toEqual([]));
    const p = last(seen);
    expect(p.has("label")).toBe(false);
    expect(p.get("priority")).toBe("LOW");
    expect(p.get("view")).toBe("all");
    expect(seen[seen.length - 1].type).toBe("REPLACE");
  });

  it("without customer:read, ?customer= is dropped from the URL and never reaches the values", async () => {
    state = { ...lists, customers: { isSuccess: false, isFetching: false } };
    const { seen, hook } = setup("?customer=12&priority=LOW", false);
    await waitFor(() => expect(last(seen).has("customer")).toBe(false));
    expect(hook.result.current.values.customerId).toEqual([]);
    expect(hook.result.current.values.priority).toEqual(["LOW"]);
    expect(hook.result.current.chips.map((c) => c.field)).toEqual(["priority"]);
    expect(seen[seen.length - 1].type).toBe("REPLACE");
  });
});
