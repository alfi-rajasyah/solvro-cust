import "./env.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../src/env.js");
});

async function withAppUrl(appUrl: string | null) {
  vi.resetModules();
  vi.doMock("../src/env.js", () => ({ env: { APP_URL: appUrl } }));
  return (await import("../src/lib/publicBaseUrl.js")).configuredPublicBaseUrl();
}

describe("configuredPublicBaseUrl", () => {
  it("returns APP_URL when the operator set a public address", async () => {
    expect(await withAppUrl("https://solvro.acme.com")).toBe("https://solvro.acme.com");
  });
  it("is null when APP_URL is unset or names a loopback host", async () => {
    expect(await withAppUrl(null)).toBeNull();
    for (const url of ["http://localhost:5173", "http://localhost", "http://127.0.0.1:8080", "http://[::1]"]) {
      expect(await withAppUrl(url)).toBeNull();
    }
  });
});
