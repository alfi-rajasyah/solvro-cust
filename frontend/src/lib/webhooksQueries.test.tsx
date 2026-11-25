// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  queryKeys,
  useCreateWebhook,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from "./queries";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function reply(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

/** Method, path and parsed JSON body of the n-th fetch call. */
function call(n = 0) {
  const [path, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { path, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
}

describe("webhook hooks", () => {
  it("useWebhooks GETs /webhooks and unwraps the list", async () => {
    reply(200, { webhooks: [{ id: 1, name: "A" }] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useWebhooks(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(call()).toMatchObject({ path: "/api/webhooks", method: "GET" });
    expect(result.current.data).toEqual([{ id: 1, name: "A" }]);
  });

  it("useCreateWebhook POSTs the body, returns the one-time secret and refreshes the list", async () => {
    reply(201, { webhook: { id: 2 }, secret: "whsec_abc" });
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateWebhook(), { wrapper });
    const input = {
      name: "Ops",
      url: "https://example.com/h",
      format: "STANDARD" as const,
      eventTypes: ["task.created"],
      projectIds: [],
    };
    let res: unknown;
    await act(async () => {
      res = await result.current.mutateAsync(input);
    });
    expect(call()).toEqual({ path: "/api/webhooks", method: "POST", body: input });
    expect(res).toEqual({ webhook: { id: 2 }, secret: "whsec_abc" });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.webhooks, exact: true });
  });

  it("useUpdateWebhook PATCHes only the given fields to the id", async () => {
    reply(200, { webhook: { id: 3, active: true } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateWebhook(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 3, active: true });
    });
    expect(call()).toEqual({ path: "/api/webhooks/3", method: "PATCH", body: { active: true } });
  });

  it("useDeleteWebhook DELETEs and drops that webhook's cached deliveries", async () => {
    reply(204);
    const { qc, wrapper } = setup();
    qc.setQueryData(queryKeys.webhookDeliveries(4), []);
    const { result } = renderHook(() => useDeleteWebhook(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(4);
    });
    expect(call()).toMatchObject({ path: "/api/webhooks/4", method: "DELETE" });
    expect(qc.getQueryData(queryKeys.webhookDeliveries(4))).toBeUndefined();
  });

  it("useRotateWebhookSecret and useTestWebhook POST to their sub-routes", async () => {
    reply(200, { secret: "whsec_new" });
    reply(200, { ok: false, statusCode: 500, error: "HTTP 500" });
    const { wrapper } = setup();
    const rotate = renderHook(() => useRotateWebhookSecret(), { wrapper });
    const test = renderHook(() => useTestWebhook(), { wrapper });
    await act(async () => {
      expect(await rotate.result.current.mutateAsync(5)).toEqual({ secret: "whsec_new" });
      expect(await test.result.current.mutateAsync(5)).toEqual({ ok: false, statusCode: 500, error: "HTTP 500" });
    });
    expect(call(0)).toMatchObject({ path: "/api/webhooks/5/rotate-secret", method: "POST" });
    expect(call(1)).toMatchObject({ path: "/api/webhooks/5/test", method: "POST" });
  });

  it("useWebhookDeliveries stays idle without an id, then GETs the deliveries and unwraps them", async () => {
    const { wrapper } = setup();
    const idle = renderHook(() => useWebhookDeliveries(null), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();

    reply(200, { deliveries: [{ id: 9, eventType: "task.created" }] });
    const { result } = renderHook(() => useWebhookDeliveries(6), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(call()).toMatchObject({ path: "/api/webhooks/6/deliveries", method: "GET" });
    expect(result.current.data).toEqual([{ id: 9, eventType: "task.created" }]);
  });
});
