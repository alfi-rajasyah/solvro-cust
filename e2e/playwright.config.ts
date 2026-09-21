import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: CI,
  retries: 1,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["list"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        // iPhone 13 viewport/UA/touch emulation, but forced onto Chromium:
        // the QA gate scripts drove mobile emulation through
        // chromium.launch() + newContext(devices["iPhone 13"]), and touch
        // drags depend on CDP's Input.dispatchTouchEvent, which only exists
        // on Chromium (devices["iPhone 13"]'s own defaultBrowserType is
        // webkit, which would silently break every touch-drag test).
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
      },
    },
  ],
});
