// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { useTasksLabelFilter } from "./useTasksLabelFilter";

type Q = { isSuccess: boolean; isFetching: boolean; data?: { name: string; projectCount: number }[] };
const names: { current: Q } = { current: { isSuccess: true, isFetching: false, data: [] } };

vi.mock("@/lib/queries", () => ({ useLabelNames: () => names.current }));

function setup(search: string) {
  const seen: { search: string; type: string }[] = [];
  function Probe() {
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
  const hook = renderHook(() => useTasksLabelFilter(true), { wrapper });
  return { seen, hook };
}

const list = (...n: string[]) => ({ isSuccess: true, isFetching: false, data: n.map((name) => ({ name, projectCount: 1 })) });

describe("useTasksLabelFilter", () => {
  beforeEach(() => {
    names.current = list("Blocked", "Bug");
  });

  it("reads repeated ?label= and writes with a replace navigation", async () => {
    const { seen, hook } = setup("?view=overdue&label=Blocked");
    expect(hook.result.current.names).toEqual(["Blocked"]);
    act(() => hook.result.current.setNames(["Blocked", "Bug"]));
    await waitFor(() => expect(hook.result.current.names).toEqual(["Blocked", "Bug"]));
    const last = seen[seen.length - 1];
    expect(last.type).toBe("REPLACE");
    expect(last.search).toContain("view=overdue");
    expect(new URLSearchParams(last.search).getAll("label")).toEqual(["Blocked", "Bug"]);
  });

  it("drops a name with no match once the list is fresh, keeping the rest", async () => {
    const { seen, hook } = setup("?label=Gone&label=bug");
    await waitFor(() => expect(hook.result.current.names).toEqual(["Bug"]));
    const last = seen[seen.length - 1];
    expect(last.type).toBe("REPLACE");
    expect(new URLSearchParams(last.search).getAll("label")).toEqual(["Bug"]);
  });

  it("does not prune while the list is loading, refetching or failed", async () => {
    for (const state of [
      { isSuccess: false, isFetching: true },
      { isSuccess: true, isFetching: true, data: [] },
      { isSuccess: false, isFetching: false },
    ]) {
      names.current = state;
      const { seen, hook } = setup("?label=Gone");
      await new Promise((r) => setTimeout(r, 0));
      expect(hook.result.current.names).toEqual(["Gone"]);
      expect(seen[seen.length - 1].search).toBe("?label=Gone");
    }
  });
});
