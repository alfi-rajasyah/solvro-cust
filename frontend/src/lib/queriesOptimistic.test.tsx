// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  queryKeys,
  reorderTasksLocally,
  useBulkUpdateTasks,
  useUpdateProjectServices,
  type ProjectDetail,
  type Section,
  type Service,
  type Task,
} from "./queries";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const svc = (id: number): Service =>
  ({ id, name: `S${id}`, description: "", active: true }) as unknown as Service;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

// useProject caches under the project key plus the local day.
const DETAIL_KEY = [...queryKeys.project(5), "2026-11-19"];

describe("useUpdateProjectServices (optimistic)", () => {
  const base = {
    id: 5,
    services: [
      { id: 1, projectId: 5, serviceId: 1, service: svc(1), tools: ["a"], createdAt: "x" },
    ],
  } as unknown as ProjectDetail;

  it("patches services[] before the server answers, then rolls back on error", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(DETAIL_KEY, base);
    qc.setQueryData([...queryKeys.project(5), "tasks"], ["untouched"]);
    qc.setQueryData(["services"], [svc(1), svc(2)]);
    let reject!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((res) => {
          reject = res;
        }),
    );
    const { result } = renderHook(() => useUpdateProjectServices(5), { wrapper });
    act(() => {
      result.current.mutate([
        { serviceId: 1, tools: ["b"] },
        { serviceId: 2, tools: [] },
      ]);
    });
    await waitFor(() => {
      const d = qc.getQueryData<ProjectDetail>(DETAIL_KEY)!;
      expect(d.services.map((s) => [s.serviceId, s.tools])).toEqual([
        [1, ["b"]],
        [2, []],
      ]);
    });
    // Server refuses: the cache returns to the snapshot.
    await act(async () => {
      reject(new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // onSettled refetch is pending/failing with the same mock; the rollback
    // value was written first.
    expect(qc.getQueryData<ProjectDetail>(DETAIL_KEY)?.services).toEqual(base.services);
    expect(qc.getQueryData([...queryKeys.project(5), "tasks"])).toEqual(["untouched"]);
  });
});

describe("reorderTasksLocally section (ISS-109)", () => {
  const sections: Section[] = [
    { id: 1, projectId: 1, name: "A", position: 0, color: "#111111", createdAt: "" },
    { id: 2, projectId: 1, name: "B", position: 1, color: "#222222", createdAt: "" },
  ];
  const task = {
    id: 10,
    status: "TODO",
    parentTaskId: null,
    epicId: null,
    position: 0,
    sectionId: 1,
    section: { id: 1, name: "A", position: 0, color: "#111111" },
  } as unknown as Task;

  it("recomputes the nested section from the sections cache", () => {
    const out = reorderTasksLocally([task], 10, { sectionId: 2, position: 0 }, sections);
    expect(out[0].sectionId).toBe(2);
    expect(out[0].section).toEqual({ id: 2, name: "B", position: 1, color: "#222222" });
  });

  it("falls back to null when the target section is not cached", () => {
    const out = reorderTasksLocally([task], 10, { sectionId: 9, position: 0 }, sections);
    expect(out[0].sectionId).toBe(9);
    expect(out[0].section).toBeNull();
  });

  it("clears it when moved out of every section", () => {
    const out = reorderTasksLocally([task], 10, { sectionId: null, position: 0 }, sections);
    expect(out[0].section).toBeNull();
  });
});

describe("useBulkUpdateTasks", () => {
  it("posts the body to /tasks/bulk and refreshes the project's task list", async () => {
    const { qc, wrapper } = setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ updated: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useBulkUpdateTasks(5), { wrapper });
    let out: { updated: number } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ taskIds: [1, 2], addLabelIds: [3] });
    });
    expect(out).toEqual({ updated: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/tasks/bulk");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ taskIds: [1, 2], addLabelIds: [3] });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey ?? null));
    expect(keys).toContain(JSON.stringify(queryKeys.projectTasks(5)));
    expect(keys).toContain(JSON.stringify(queryKeys.workloadRoot));
    expect(keys).toContain(JSON.stringify(queryKeys.dailyReviewRoot));
  });
});
