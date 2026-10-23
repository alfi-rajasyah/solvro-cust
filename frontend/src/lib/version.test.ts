// The login page shows __APP_VERSION__, injected by vite.config.ts from
// frontend/package.json. Before this the page carried a hard-coded string
// ("v1.4.0 · build 2305") that matched nothing in the repository.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("__APP_VERSION__", () => {
  it("is the frontend package version and matches the repository VERSION file", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(__APP_VERSION__).toBe(pkg.version);
    const repoVersion = readFileSync(new URL("../../../VERSION", import.meta.url), "utf8").trim();
    expect(`v${__APP_VERSION__}`).toBe(repoVersion);
  });
});
