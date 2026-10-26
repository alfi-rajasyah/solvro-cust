// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TOKEN_STORAGE_KEY } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { tokenExpiryMs } from "@/lib/sessionExpiry";
import { SessionExpiryPrompt } from "./SessionExpiryPrompt";

const START = new Date("2026-01-01T10:00:00Z").getTime();

function makeToken(expMs: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: 1, ver: 0, exp: Math.floor(expMs / 1000) })}.sig`;
}

const me = { id: 1, email: "a@solvro.pl", username: "a", role: "TAM", permissions: [] };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <SessionExpiryPrompt />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("tokenExpiryMs", () => {
  it("reads exp and tolerates junk", () => {
    expect(tokenExpiryMs(makeToken(START + 60_000))).toBe(START + 60_000);
    expect(tokenExpiryMs("junk")).toBeNull();
    expect(tokenExpiryMs(null)).toBeNull();
  });
});

describe("SessionExpiryPrompt", () => {
  it("appears five minutes before expiry and Stay signed in swaps the token", async () => {
    const oldExp = START + 10 * 60_000;
    const fresh = makeToken(START + 8 * 3600_000);
    localStorage.setItem(TOKEN_STORAGE_KEY, makeToken(oldExp));
    fetchMock.mockImplementation(async (url: string) =>
      String(url) === "/api/auth/refresh"
        ? new Response(JSON.stringify({ token: fresh }), { status: 200 })
        : new Response(JSON.stringify(me), { status: 200 }),
    );
    setup();
    expect(screen.queryByTestId("session-expiry-prompt")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(screen.queryByTestId("session-expiry-prompt")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + 15_000);
    });
    expect(screen.getByTestId("session-expiry-prompt").textContent).toMatch(/expires in [45] minutes/);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/auth/refresh");
    expect(call?.[1].method).toBe("POST");
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(fresh);
    expect(screen.queryByTestId("session-expiry-prompt")).toBeNull();
  });

  it("Dismiss hides it without touching the token", async () => {
    const tok = makeToken(START + 4 * 60_000);
    localStorage.setItem(TOKEN_STORAGE_KEY, tok);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(me), { status: 200 }));
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByTestId("session-expiry-prompt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("session-expiry-prompt")).toBeNull();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(tok);
  });

  it("says the session cannot be extended when the server answers session_max_age, with no retry button", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, makeToken(START + 4 * 60_000));
    fetchMock.mockImplementation(async (url: string) =>
      String(url) === "/api/auth/refresh"
        ? new Response(JSON.stringify({ error: "max", code: "session_max_age" }), { status: 409 })
        : new Response(JSON.stringify(me), { status: 200 }),
    );
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("session-expiry-prompt").textContent).toMatch(/cannot be extended/);
    expect(screen.queryByRole("button", { name: "Stay signed in" })).toBeNull();
  });

  it("treats a refreshed token that does not expire later as the cap and keeps the old token", async () => {
    const old = makeToken(START + 4 * 60_000);
    localStorage.setItem(TOKEN_STORAGE_KEY, old);
    fetchMock.mockImplementation(async (url: string) =>
      String(url) === "/api/auth/refresh"
        ? new Response(JSON.stringify({ token: makeToken(START + 4 * 60_000) }), { status: 200 })
        : new Response(JSON.stringify(me), { status: 200 }),
    );
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("session-expiry-prompt").textContent).toMatch(/cannot be extended/);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(old);
  });
});
