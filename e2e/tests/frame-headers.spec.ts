import { test, expect } from "@playwright/test";

// Anti-framing headers come from the bundled nginx (frontend/nginx.conf +
// frontend/nginx-frame-protection.conf), so this spec only passes against the
// built image (CI's :8080). The Vite dev server (:5173) sends neither header —
// like pwa.spec.ts, it is expected to fail there; the skip below makes that
// explicit instead of a false failure.
const PATHS = [
  "/",
  "/projects/1",
  "/share/x",
  "/assets/does-not-exist.js", // 404 error path — headers must survive via `always`
  "/sw.js",
];

test.describe("frame headers", () => {
  for (const path of PATHS) {
    test(`${path} refuses cross-origin framing`, async ({ request, baseURL }) => {
      test.skip(
        new URL(baseURL ?? "http://localhost:8080").port === "5173",
        "framing headers are set by the built nginx image, not the Vite dev server",
      );
      const res = await request.get(path);
      const csp = res.headers()["content-security-policy"] ?? "";
      expect(csp, `${path} (HTTP ${res.status()}) CSP`).toContain("frame-ancestors 'self'");
      expect(res.headers()["x-frame-options"], `${path} X-Frame-Options`).toBe("SAMEORIGIN");
    });
  }
});
