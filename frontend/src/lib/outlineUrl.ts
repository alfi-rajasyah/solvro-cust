// Client-side twin of the backend's Outline URL rule (backend/src/lib/outlineUrl.ts):
// trimmed, empty clears, http(s) only, at most 2048 characters. The form checks
// it inline so a bad link never leaves the dialog; the server stays the authority
// (docs/archive/plans/outline-integration.md §3).
export const OUTLINE_URL_MAX_LENGTH = 2048;

export type OutlineUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseOutlineUrl(raw: string): OutlineUrlResult {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > OUTLINE_URL_MAX_LENGTH) {
    return { ok: false, error: `Use at most ${OUTLINE_URL_MAX_LENGTH} characters.` };
  }
  // `new URL()` silently skips leading control characters; the server refuses them.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    return { ok: false, error: "The address must not contain control characters." };
  }
  try {
    const { protocol } = new URL(value);
    if (protocol === "http:" || protocol === "https:") return { ok: true, value };
  } catch {
    // fall through to the shared message
  }
  return { ok: false, error: "Enter a full address starting with http:// or https://." };
}

/**
 * The Admin › Outline address: the same rule, plus it must be a plain address
 * (no login, query string or fragment) — the server answers 400 otherwise.
 */
export function parseOutlineBaseUrl(raw: string): OutlineUrlResult {
  const parsed = parseOutlineUrl(raw);
  if (!parsed.ok || parsed.value === null) return parsed;
  const u = new URL(parsed.value);
  if (u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") {
    return { ok: false, error: "The address must not contain a login, query string or fragment." };
  }
  return parsed;
}

/**
 * The value to put in an `href`, or null when it is empty or not http(s). Every
 * Outline link in the app goes through this, so a stored `javascript:` value
 * could never become a clickable link.
 */
export function safeOutlineHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const parsed = parseOutlineUrl(url);
  return parsed.ok ? parsed.value : null;
}
