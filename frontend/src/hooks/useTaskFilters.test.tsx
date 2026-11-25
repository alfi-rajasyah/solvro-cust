// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router";
import { useTaskFilters } from "./useTaskFilters";

type Q = { isSuccess: boolean; isFetching: boolean; data?: { id: number }[] };
const epics: { current: Q } = { current: { isSuccess: true, isFetching: false, data: [] } };
const labels: { current: Q } = { current: { isSuccess: true, isFetching: false, data: [] } };

vi.mock("@/lib/queries", () => ({
  useProjectEpics: () => epics.current,
  useProjectLabels: () => labels.current,
}));

function setup(search: string) {
  const seen: { search: string; type: string }[] = [];
  function Probe() {
    const loc = useLocation();
    const type = useNavigationType();
    seen.push({ search: loc.search, type });
    return null;
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/projects/4/list${search}`]}>
      <Routes>
        <Route
          path="/projects/:id/list"
          element={
            <>
              <Probe />
              {children}
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  const hook = renderHook(() => useTaskFilters(), { wrapper });
  return { seen, hook };
}

describe("useTaskFilters stale-id pruning", () => {
  beforeEach(() => {
    epics.current = { isSuccess: true, isFetching: false, data: [{ id: 1 }, { id: 2 }] };
    labels.current = { isSuccess: true, isFetching: false, data: [{ id: 5 }] };
  });

  it("drops a deleted epic and label with a replace navigation", async () => {
    const { seen, hook } = setup("?epicFilter=9&labels=5,8,none&assignee=3");
    await waitFor(() => expect(hook.result.current.filters.epic).toBe("all"));
    expect(hook.result.current.filters.labelIds).toEqual([5]);
    expect(hook.result.current.filters.noLabel).toBe(true);
    expect(hook.result.current.filters.assigneeId).toBe(3);
    const last = seen[seen.length - 1];
    expect(last.type).toBe("REPLACE");
    expect(last.search).not.toContain("epicFilter");
  });

  it("keeps valid ids and none", async () => {
    const { seen } = setup("?epicFilter=2&labels=5");
    expect(seen.every((s) => s.type === "POP")).toBe(true);
  });

  it("keeps epic none", () => {
    const { hook } = setup("?epicFilter=none");
    expect(hook.result.current.filters.epic).toBe("none");
  });

  it("drops nothing while the lists are loading, refetching or failed", () => {
    epics.current = { isSuccess: false, isFetching: true };
    labels.current = { isSuccess: false, isFetching: false };
    const a = setup("?epicFilter=9&labels=8");
    expect(a.hook.result.current.filters.epic).toBe(9);
    expect(a.hook.result.current.filters.labelIds).toEqual([8]);
    a.hook.unmount();

    epics.current = { isSuccess: true, isFetching: true, data: [] };
    const b = setup("?epicFilter=9");
    expect(b.hook.result.current.filters.epic).toBe(9);
  });
});
