// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const itop: { configured: boolean; isLoading: boolean } = { configured: true, isLoading: false };
const utilizationCalls: { scope: string; enabled: boolean | undefined }[] = [];
vi.mock("@/lib/queries", () => ({
  useUtilization: (_week: string, scope: string, opts?: { enabled?: boolean }) => {
    utilizationCalls.push({ scope, enabled: opts?.enabled });
    return { data: undefined, isLoading: false, isError: false, error: null };
  },
  useRequestItopRefresh: () => refreshState,
  useItopStatus: () => ({ data: itop.isLoading ? undefined : { configured: itop.configured }, isLoading: itop.isLoading }),
  useWorkload: () => ({ data: undefined, isLoading: true, isError: false, error: null }),
  useWorkloadTasks: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import { Utilization } from "./Utilization";

function show(url = "/utilization") {
  render(
    <MemoryRouter initialEntries={[url]}>
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

describe("Utilization tabs without iTop", () => {
  beforeEach(() => {
    utilizationCalls.length = 0;
  });
  afterEach(() => {
    cleanup();
    itop.configured = true;
    itop.isLoading = false;
    utilizationCalls.length = 0;
  });

  it("shows only the Workload tab and never loads iTop hours", () => {
    itop.configured = false;
    show();
    expect(screen.getByTestId("utilization-tab-workload")).toBeTruthy();
    expect(screen.queryByTestId("utilization-tab-me")).toBeNull();
    expect(screen.queryByTestId("utilization-tab-tam")).toBeNull();
    expect(screen.queryByTestId("utilization-tab-customer")).toBeNull();
    expect(screen.queryByLabelText("Refresh from iTop")).toBeNull();
    expect(utilizationCalls.every((c) => c.enabled === false)).toBe(true);
  });

  it("falls back to Workload when a stale link asks for an iTop scope", () => {
    itop.configured = false;
    show("/utilization?scope=customer");
    expect(screen.queryByTestId("utilization-tab-customer")).toBeNull();
    expect(screen.getByTestId("utilization-tab-workload").className).toContain("text-primary");
  });

  it("with iTop connected keeps Me as the default and adds Workload", () => {
    show();
    expect(screen.getByTestId("utilization-tab-me").className).toContain("text-primary");
    expect(screen.getByTestId("utilization-tab-workload")).toBeTruthy();
    expect(screen.getByLabelText("Refresh from iTop")).toBeTruthy();
  });

  it("fires no iTop query while the connection status is unknown", () => {
    itop.isLoading = true;
    show();
    expect(utilizationCalls.every((c) => c.enabled === false)).toBe(true);
  });
});
