// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ApiError,
  FORBIDDEN_EVENT,
  TOKEN_STORAGE_KEY,
  UNAUTHENTICATED_EVENT,
  apiRequest,
  setToken,
  setTokenRotating,
} from "./api";

function respond(status: number, body: unknown) {
  return new Response(body === null ? "" : JSON.stringify(body), { status });
}

const fetchMock = vi.fn();
let unauth: Mock<() => void>;
let forbidden: Mock<() => void>;

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  unauth = vi.fn<() => void>();
  forbidden = vi.fn<() => void>();
  window.addEventListener(UNAUTHENTICATED_EVENT, unauth);
  window.addEventListener(FORBIDDEN_EVENT, forbidden);
});

afterEach(() => {
  window.removeEventListener(UNAUTHENTICATED_EVENT, unauth);
  window.removeEventListener(FORBIDDEN_EVENT, forbidden);
  setTokenRotating(false);
  vi.unstubAllGlobals();
});

describe("apiRequest request shape", () => {
  it("calls the /api base with the bearer token from localStorage", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    fetchMock.mockResolvedValue(respond(200, { ok: true }));
    const data = await apiRequest<{ ok: boolean }>("/projects");
    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
    expect(init.method).toBe("GET");
  });

  it("sends no Authorization header without a token or with auth:false", async () => {
    fetchMock.mockImplementation(async () => respond(200, {}));
    await apiRequest("/a");
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    await apiRequest("/auth/login", { method: "POST", body: { e: 1 }, auth: false });
    for (const call of fetchMock.mock.calls as [string, RequestInit][]) {
      expect((call[1].headers as Record<string, string>)["Authorization"]).toBeUndefined();
    }
  });

  it("serialises a JSON body with a content type", async () => {
    fetchMock.mockResolvedValue(respond(200, {}));
    await apiRequest("/tasks/1", { method: "PATCH", body: { title: "x" } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"title":"x"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("resolves null for an empty body", async () => {
    fetchMock.mockResolvedValue(respond(200, null));
    await expect(apiRequest("/tasks/1", { method: "DELETE" })).resolves.toBeNull();
  });
});

describe("apiRequest errors", () => {
  it("throws ApiError carrying status, the server message and the body", async () => {
    fetchMock.mockResolvedValue(respond(422, { error: "Title required", code: "invalid" }));
    const err = await apiRequest("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).message).toBe("Title required");
    expect((err as ApiError).body).toEqual({ error: "Title required", code: "invalid" });
  });

  it("falls back to a status message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(apiRequest("/x")).rejects.toMatchObject({
      status: 502,
      message: "Request failed with status 502",
    });
  });

  it("does not fire any session event for non-session failures", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    for (const status of [400, 404, 409, 500, 503]) {
      fetchMock.mockResolvedValueOnce(respond(status, { error: "nope" }));
      await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiError);
    }
    expect(unauth).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("a network failure rejects without signing the user out", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(TypeError);
    expect(unauth).not.toHaveBeenCalled();
  });
});

describe("401 handling", () => {
  it("an authenticated 401 dispatches solvro:unauthenticated and still rejects", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    fetchMock.mockResolvedValue(respond(401, { error: "Unauthorized" }));
    await expect(apiRequest("/projects")).rejects.toMatchObject({ status: 401 });
    expect(unauth).toHaveBeenCalledTimes(1);
  });

  it("a 401 from an unauthenticated call (login) does not sign anyone out", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    fetchMock.mockResolvedValue(respond(401, { error: "Wrong password" }));
    await expect(apiRequest("/auth/login", { method: "POST", auth: false })).rejects.toMatchObject({
      status: 401,
    });
    expect(unauth).not.toHaveBeenCalled();
  });

  it("a late 401 for an old token does not sign out a fresh login", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "old");
    fetchMock.mockImplementation(async () => {
      setToken("new"); // user signs in again while the request is in flight
      return respond(401, { error: "Unauthorized" });
    });
    await expect(apiRequest("/projects")).rejects.toMatchObject({ status: 401 });
    expect(unauth).not.toHaveBeenCalled();
  });

  it("a 401 while this tab is rotating its own token is ignored", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    setTokenRotating(true);
    fetchMock.mockResolvedValue(respond(401, { error: "Unauthorized" }));
    await expect(apiRequest("/projects")).rejects.toMatchObject({ status: 401 });
    expect(unauth).not.toHaveBeenCalled();
  });
});

describe("403 handling", () => {
  it("a 403 with code forbidden dispatches solvro:forbidden", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    fetchMock.mockResolvedValue(respond(403, { error: "Forbidden", code: "forbidden" }));
    await expect(apiRequest("/admin/users")).rejects.toMatchObject({ status: 403 });
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(unauth).not.toHaveBeenCalled();
  });

  it("a 403 with another code (or none) does not trigger a permission refresh", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    fetchMock.mockResolvedValueOnce(respond(403, { error: "Nope", code: "something_else" }));
    fetchMock.mockResolvedValueOnce(respond(403, { error: "Nope" }));
    await expect(apiRequest("/a")).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/b")).rejects.toBeInstanceOf(ApiError);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("a forbidden 403 on an unauthenticated call is ignored", async () => {
    fetchMock.mockResolvedValue(respond(403, { error: "Forbidden", code: "forbidden" }));
    await expect(apiRequest("/guest", { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(forbidden).not.toHaveBeenCalled();
  });
});
