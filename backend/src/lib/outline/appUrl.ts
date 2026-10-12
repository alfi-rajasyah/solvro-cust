// APP_URL: the public Solvro origin, used to build the Outline OAuth redirect
// URI and webhook URL shown to the admin and to recognise Solvro links inside
// Outline pages (docs/archive/plans/outline-integration.md, F13). CORS_ORIGIN
// cannot serve — it may be a comma list or `*`. Pure (no env import) so
// src/env.ts can validate with it.

/**
 * Normalises `value` to a bare http(s) origin (`https://solvro.acme.com`,
 * optional port, no trailing slash), or returns null when it is not one: a
 * path, query, fragment or login makes it invalid rather than being silently
 * dropped, so a misconfigured value fails loudly at boot.
 */
export function parseAppUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/") return null;
  return url.origin;
}

// The browser-facing URLs. Behind the dev vite proxy and prod nginx the `/api`
// prefix is stripped before the request reaches the backend, so
// `${APP_URL}/api/outline/oauth/callback` lands on the backend route
// `/outline/oauth/callback` and `${APP_URL}/api/webhook/outline` on
// `/webhook/outline`.

/** The OAuth redirect URI the admin registers in Outline. */
export function outlineRedirectUri(appUrl: string): string {
  return `${appUrl}/api/outline/oauth/callback`;
}

/** The webhook URL the admin registers in Outline. */
export function outlineWebhookUrl(appUrl: string): string {
  return `${appUrl}/api/webhook/outline`;
}

const DEV_APP_URL = "http://localhost:5173";

/**
 * Resolves the APP_URL env value. Unset/blank falls back to the dev address
 * outside production; in production it stays `null` (unset) so Outline sign-in
 * and mentions refuse to run instead of silently building localhost URLs.
 * Returns `undefined` for a value that is set but not a bare http(s) origin.
 */
export function resolveAppUrl(raw: string | undefined, nodeEnv: string): string | null | undefined {
  if (raw === undefined || raw.trim() === "") return nodeEnv === "production" ? null : DEV_APP_URL;
  return parseAppUrl(raw) ?? undefined;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

/**
 * A warning for an APP_URL Outline will not accept as an OAuth redirect URI:
 * Outline requires https unless the host is loopback (F3) and otherwise fails
 * after Authorize with a misleading "redirect_uri does not match". Null when fine.
 */
export function appUrlWarning(appUrl: string | null): string | null {
  if (appUrl === null) return null;
  const url = new URL(appUrl);
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    return "APP_URL uses http on a non-loopback host. Outline only accepts an https OAuth redirect URI (loopback excepted), so sign-in will fail until APP_URL is https.";
  }
  return null;
}
