// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api";
import { queryKeys, useUpdateTask, type Task } from "./queries";

const fetchMock = vi.fn();
const PROJECT = 7;

function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT,
    title: `Task ${id}`,
    status: "TODO",
    priority: "MEDIUM",
    parentTaskId: null,
    epicId: null,
    position: id,
    labels: [],
    ...over,
  } as unknown as Task;
}

function setup(initial: Task[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(queryKeys.projectTasks(PROJECT), initial);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdateTask(PROJECT), { wrapper });
  const cached = () => qc.getQueryData<Task[]>(queryKeys.projectTasks(PROJECT));
  return { qc, result, cached };
}

// A request the test settles by hand, so the optimistic window can be observed.
function deferred() {
  let resolve!: (r: Response) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useUpdateTask optimistic update", () => {
  it("writes the patch to the cache before the server answers, then invalidates on success", async () => {
    const d = deferred();
    fetchMock.mockReturnValue(d.promise);
    const { qc, result, cached } = setup([task(1), task(2)]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ id: 1, patch: { title: "Renamed", status: "DONE" } });
    });
    await waitFor(() => expect(cached()?.find((t) => t.id === 1)?.title).toBe("Renamed"));
    expect(cached()?.find((t) => t.id === 1)?.status).toBe("DONE");
    expect(cached()?.find((t) => t.id === 2)?.title).toBe("Task 2"); // untouched
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.projectTasks(PROJECT) });

    await act(async () => {
      d.resolve(new Response(JSON.stringify(task(1, { title: "Renamed", status: "DONE" })), { status: 200 }));
      await pending;
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tasks/1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Renamed", status: "DONE" });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projectTasks(PROJECT) }),
    );
  });

  it("restores the exact pre-edit snapshot when the save fails, then invalidates to resync", async () => {
    const d = deferred();
    fetchMock.mockReturnValue(d.promise);
    const before = [task(1), task(2)];
    const { qc, result, cached } = setup(before);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ id: 1, patch: { title: "Doomed" } }).catch((e: unknown) => e);
    });
    await waitFor(() => expect(cached()?.find((t) => t.id === 1)?.title).toBe("Doomed"));

    await act(async () => {
      d.resolve(new Response(JSON.stringify({ error: "Server exploded" }), { status: 500 }));
      const err = await pending;
      expect(err).toBeInstanceOf(ApiError);
    });

    expect(cached()).toEqual(before);
    expect(cached()?.find((t) => t.id === 1)?.title).toBe("Task 1");
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projectTasks(PROJECT) }),
    );
  });

  it("a network failure rolls back too", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const before = [task(1)];
    const { result, cached } = setup(before);
    await act(async () => {
      await result.current.mutateAsync({ id: 1, patch: { priority: "HIGH" } }).catch(() => undefined);
    });
    expect(cached()).toEqual(before);
  });
});
