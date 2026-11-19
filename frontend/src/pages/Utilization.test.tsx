// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const refreshState: { isError: boolean; error: unknown; isPending: boolean; mutate: () => void } = {
  isError: true,
  error: null,
  isPending: false,
  mutate: () => {},
};

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] }, userVerified: true }),
  hasPermission: () => false,
}));
vi.mock("@/lib/queries", () => ({
  useUtilization: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
  useRequestItopRefresh: () => refreshState,
}));

import { Utilization } from "./Utilization";

function show() {
  render(
    <MemoryRouter>
      <Utilization />
    </MemoryRouter>,
  );
}

describe("Utilization Refresh error", () => {
  afterEach(cleanup);

  it("shows the server message of a failed Refresh (429)", () => {
    refreshState.error = new ApiError(429, "iTop was refreshed very recently. Try again shortly.", {});
    show();
    expect(screen.getByTestId("utilization-refresh-error").textContent).toContain("refreshed very recently");
  });

  it("shows a fallback for a network error", () => {
    refreshState.error = new TypeError("Failed to fetch");
    show();
    expect(screen.getByTestId("utilization-refresh-error").textContent).toContain("Could not reach the server");
  });
});
