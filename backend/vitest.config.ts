import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    // Ordering tests share one Postgres schema and reset it between files,
    // so run test files serially to avoid cross-file interference.
    fileParallelism: false,
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/env.ts"],
  },
});
