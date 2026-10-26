// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FORBIDDEN_EVENT, TOKEN_STORAGE_KEY, UNAUTHENTICATED_EVENT } from "./api";
import { AuthProvider, useAuth } from "./auth";

// AuthProvider wired to the api.ts events: a revoked session signs out and
// empties the query cache; a forbidden answer re-reads /auth/me, throttled.
const fetchMock = vi.fn();
const me = { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions: ["task:read"] };

function Probe() {
  const { status, user } = useAuth();
  return <p data-testid="s">{`${status}:${user?.permissions.join(",") ?? "none"}`}</p>;
}

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(["secret"], "previous user's data");
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const meCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/auth/me").length;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOKEN_STORAGE_KEY, "tok");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(me), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthProvider session events", () => {
  it("solvro:unauthenticated signs out, drops the token and clears the query cache", async () => {
    const qc = setup();
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("authenticated:task:read"));
    act(() => {
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    });
    expect(screen.getByTestId("s").textContent).toBe("unauthenticated:none");
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(qc.getQueryData(["secret"])).toBeUndefined();
  });

  it("solvro:forbidden re-reads /auth/me once, and a burst inside the throttle window does not loop", async () => {
    setup();
    await waitFor(() => expect(meCalls()).toBe(1)); // boot rehydrate
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ ...me, permissions: ["*"] }), { status: 200 }),
    );
    act(() => {
      window.dispatchEvent(new Event(FORBIDDEN_EVENT));
      window.dispatchEvent(new Event(FORBIDDEN_EVENT));
      window.dispatchEvent(new Event(FORBIDDEN_EVENT));
    });
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("authenticated:*"));
    expect(meCalls()).toBe(2);
  });
});
