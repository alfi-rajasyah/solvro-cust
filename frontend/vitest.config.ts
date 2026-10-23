import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import path from "node:path";

// Minimal, standalone Vitest config — deliberately NOT merged with
// vite.config.ts (which pulls in the Tailwind/React/PWA plugins that pure
// node-environment function tests don't need). Only the `@` alias is
// mirrored so modules under test can import `@/lib/...` the same way the
// app does. Node environment, .ts-only, no globals — see
// docs/plans/kanban-reui-swap/plan.md Task 4.
export default defineConfig({
  // Same build-time constant vite.config.ts defines (the login page's version),
  // so src/lib/version.test.ts and any component reading it run under vitest.
  define: {
    __APP_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version,
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Pure-function tests (`.test.ts`) run in node. A component test is a
  // `.test.tsx` file whose first line is `// @vitest-environment jsdom`, and it
  // calls Testing Library's `cleanup` in an `afterEach` (with `globals: false`
  // Testing Library cannot register that itself).
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
  },
});
