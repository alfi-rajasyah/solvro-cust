import { test, expect } from "@playwright/test";

// Anti-framing headers come from the bundled nginx (frontend/nginx.conf +
// frontend/nginx-frame-protection*.conf), so this spec only passes against the
// built image (CI's :8080). The Vite dev server (:5173) sends neither header —
// like pwa.spec.ts, it is expected to fail there; the skip below makes that
// explicit instead of a false failure.
//
// CI's frontend container runs with EMBED_FRAME_ANCESTORS=https://docs.example.com
// (ci/docker-compose.ci.yml). Against an image started with a different value,
// set EXPECT_EMBED_FRAME_ANCESTORS to it — an empty string means "embedding
// disabled" (no widening, X-Frame-Options kept on /embed/ and /share/ too).
const EMBED_ORIGINS = process.env.EXPECT_EMBED_FRAME_ANCESTORS ?? "https://docs.example.com";

// Pages that must stay strictly same-origin whatever EMBED_FRAME_ANCESTORS is.
const STRICT_PATHS = [
  "/",
  "/projects/1",
  "/assets/does-not-exist.js", // 404 error path — headers must survive via `always`
  "/sw.js",
  "/embedx", // prefix lookalike
  // Only the exact pages the SPA renders are widened. Anything else under the
  // two prefixes can end in the SPA's catch-all redirect to the full app, so it
  // must keep the strict header.
  "/embed/",
  "/embed/x",
  "/embed/projects/x/tasks", // non-numeric project id
  "/embed/projects/1/tasks/extra",
  "/embed/projects/1/other",
  "/embed/projects/1/tasks%0A", // newline must not satisfy the end anchor
  "/share/",
  "/share/a/b",
  "/share/x%2Fy", // encoded slash = two segments
  "/share/x.y", // not a base64url token
  "/embed//projects/1/tasks", // nginx merges the slashes for location matching; the raw URI is what counts
  "/share//x",
  // Encoded separators: nginx matches the decoded URI, the browser keeps the raw
  // one, so no SPA route matches and its catch-all would show the full app.
  "/embed%2Fprojects%2F1%2Ftasks",
  "/embed/projects/1%2Ftasks",
  "/share%2Fx",
  "/x/..%2Fembed/projects/1/tasks",
  "/x/..%2Fshare/abc",
  "/embed/projects/1/tasks%2F",
  "/share/abc%2F",
];

// Pages an Outline page may frame (signed-in embed, guest link / guest embed).
const EMBEDDABLE_PATHS = [
  "/embed/projects/1/tasks",
  "/embed/projects/1/status",
  "/embed/projects/12/timeline",
  "/embed/projects/1/tasks/", // React Router also matches the trailing slash
  "/share/x",
  "/share/AbC_-9",
];

function skipOnDevServer(baseURL: string | undefined) {
  test.skip(
    new URL(baseURL ?? "http://localhost:8080").port === "5173",
    "framing headers are set by the built nginx image, not the Vite dev server",
  );
}

test.describe("frame headers", () => {
  for (const path of STRICT_PATHS) {
    test(`${path} refuses cross-origin framing`, async ({ request, baseURL }) => {
      skipOnDevServer(baseURL);
      const res = await request.get(path);
      const csp = res.headers()["content-security-policy"] ?? "";
      expect(csp.trim(), `${path} (HTTP ${res.status()}) CSP`).toBe("frame-ancestors 'self'");
      expect(res.headers()["x-frame-options"], `${path} X-Frame-Options`).toBe("SAMEORIGIN");
    });
  }

  for (const path of EMBEDDABLE_PATHS) {
    test(`${path} allows only 'self' + EMBED_FRAME_ANCESTORS`, async ({ request, baseURL }) => {
      skipOnDevServer(baseURL);
      const res = await request.get(path);
      const csp = res.headers()["content-security-policy"] ?? "";
      expect(csp, `${path} must not leak an unsubstituted variable`).not.toContain("$");
      expect(csp.trim(), `${path} (HTTP ${res.status()}) CSP`).toBe(
        `frame-ancestors 'self'${EMBED_ORIGINS ? ` ${EMBED_ORIGINS}` : ""}`,
      );
      if (EMBED_ORIGINS) {
        // X-Frame-Options cannot express an allow-list, so it is dropped here.
        expect(res.headers()["x-frame-options"], `${path} X-Frame-Options`).toBeUndefined();
      } else {
        expect(res.headers()["x-frame-options"], `${path} X-Frame-Options`).toBe("SAMEORIGIN");
      }
    });
  }

  test("/embed/ serves the SPA shell, uncached and unindexed", async ({ request, baseURL }) => {
    skipOnDevServer(baseURL);
    const res = await request.get("/embed/projects/1/tasks");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["referrer-policy"]).toBe("no-referrer");
    expect(res.headers()["x-robots-tag"]).toBe("noindex");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await res.text()).toContain('<div id="root">');
  });

  test("the app shell and its assets send nosniff and a strict-origin referrer policy", async ({ request, baseURL }) => {
    skipOnDevServer(baseURL);
    for (const path of ["/", "/projects/1", "/sw.js", "/manifest.webmanifest"]) {
      const res = await request.get(path);
      expect(res.headers()["x-content-type-options"], `${path} nosniff`).toBe("nosniff");
      expect(res.headers()["referrer-policy"], `${path} referrer`).toBe("strict-origin-when-cross-origin");
    }
  });
});
