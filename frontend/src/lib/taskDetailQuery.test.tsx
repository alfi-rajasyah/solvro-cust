// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  queryKeys,
  useAddComment,
  useBulkUpdateTasks,
  useCreateTask,
  useDeleteLabel,
  useDeleteSection,
  useDeleteTask,
  useDuplicateTask,
  useUpdateSection,
  useUpdateTask,
} from "./queries";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ id: 9, epicId: null, updated: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.task(7), { id: 7, title: "Old" });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const stale = (qc: QueryClient) => qc.getQueryState(queryKeys.task(7))?.isInvalidated === true;

// The /tasks/:id page reads its row from queryKeys.task(id). Every mutation that
// changes a task (or what the row embeds) must leave that entry invalidated.
describe("the task page entry is refreshed by every task mutation", () => {
  it("useUpdateTask", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useUpdateTask(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 7, patch: { title: "New" } });
    });
    expect(stale(qc)).toBe(true);
  });

  it("useBulkUpdateTasks", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useBulkUpdateTasks(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ taskIds: [7], priority: "HIGH" });
    });
    expect(stale(qc)).toBe(true);
  });

  it("useCreateTask (a new subtask changes the parent's counts)", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateTask(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ title: "Sub", parentTaskId: 7 });
    });
    expect(stale(qc)).toBe(true);
  });

  it("useDuplicateTask", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDuplicateTask(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(7);
    });
    expect(stale(qc)).toBe(true);
  });

  it("useDeleteLabel (labels ride on the row)", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDeleteLabel(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(stale(qc)).toBe(true);
  });

  it("useUpdateSection (the section rides on the row)", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useUpdateSection(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 1, patch: { name: "N" } });
    });
    expect(stale(qc)).toBe(true);
  });

  it("useDeleteSection", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDeleteSection(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(stale(qc)).toBe(true);
  });

  it("useAddComment (the row carries the comment count)", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useAddComment(7, 5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ body: "Hi" });
    });
    expect(stale(qc)).toBe(true);
  });

  it("useDeleteTask drops the deleted task's entry instead of refetching it into a 404", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(queryKeys.task(8), { id: 8, title: "Other" });
    const { result } = renderHook(() => useDeleteTask(5), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(7);
    });
    expect(qc.getQueryState(queryKeys.task(7))).toBeUndefined();
    expect(qc.getQueryState(queryKeys.task(8))?.isInvalidated).toBe(true);
  });
});
