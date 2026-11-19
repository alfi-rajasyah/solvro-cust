// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  DEFAULT_TIMEOUT_MS,
  LONG_TIMEOUT_MS,
  TOKEN_STORAGE_KEY,
  UNAUTHENTICATED_EVENT,
  apiRequest,
} from "./api";

const fetchMock = vi.fn();

/** A fetch that never answers but honours its abort signal, like the real one. */
function hangingFetch(_url: string, init: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("apiRequest timeout", () => {
  it("rejects a hung request with a plain ApiError, never a 401, and does not sign out", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok");
    const unauth = vi.fn();
    window.addEventListener(UNAUTHENTICATED_EVENT, unauth);
    fetchMock.mockImplementation(hangingFetch);
    const p = apiRequest("/tasks/1", { method: "PATCH", body: {} });
    const assertion = expect(p).rejects.toMatchObject({
      status: 408,
      message: expect.stringContaining("Check whether the change was saved"),
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
    await assertion;
    await p.catch((e) => expect(e).toBeInstanceOf(ApiError));
    expect(unauth).not.toHaveBeenCalled();
    window.removeEventListener(UNAUTHENTICATED_EVENT, unauth);
  });

  it("keeps the retry wording for a GET", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const p = apiRequest("/x");
    const assertion = expect(p).rejects.toMatchObject({
      status: 408,
      message: expect.stringContaining("try again"),
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
    await assertion;
  });

  it("honours a longer per-call timeout", async () => {
    fetchMock.mockImplementation(hangingFetch);
    let settled = false;
    const p = apiRequest("/admin/itop/sync", { timeoutMs: LONG_TIMEOUT_MS }).catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(LONG_TIMEOUT_MS);
    await p;
    expect(settled).toBe(true);
  });

  it("leaves a caller abort as the caller's own abort error", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const ctrl = new AbortController();
    const p = apiRequest("/x", { signal: ctrl.signal });
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    ctrl.abort();
    await assertion;
  });

  it("does not time out a request that answers in time", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(apiRequest("/x")).resolves.toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
