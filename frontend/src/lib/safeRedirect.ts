/**
 * Where to send a user after sign-in. `from` travels through router state, so
 * accept only an in-app path: a string starting with a single "/" (not "//" or
 * "/\", which browsers read as a protocol-relative URL to another origin).
 * Anything else falls back to the Overview page.
 */
export const DEFAULT_POST_LOGIN_PATH = "/overview";

// Placeholder origin for parsing only; the value is never used to navigate.
const PARSE_BASE = "http://solvro.invalid";

export function safeRedirectPath(from: unknown): string {
  if (typeof from !== "string") return DEFAULT_POST_LOGIN_PATH;
  if (!from.startsWith("/")) return DEFAULT_POST_LOGIN_PATH;
  if (from.startsWith("//") || from.startsWith("/\\")) return DEFAULT_POST_LOGIN_PATH;
  // URL parsers strip tabs/newlines and treat "\\" as "/", so "/\t/evil.com"
  // becomes "//evil.com" — reject control characters and backslashes outright.
  if (/[\u0000-\u001f\u007f\\]/.test(from)) return DEFAULT_POST_LOGIN_PATH;
  try {
    if (new URL(from, PARSE_BASE).origin !== PARSE_BASE) return DEFAULT_POST_LOGIN_PATH;
  } catch {
    return DEFAULT_POST_LOGIN_PATH;
  }
  return from;
}
