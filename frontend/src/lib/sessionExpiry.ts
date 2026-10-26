/** The warning appears this long before the session token expires. */
export const SESSION_WARNING_LEAD_MS = 5 * 60_000;

/**
 * The expiry of a session token (a JWT) in epoch milliseconds, or null when it
 * has no readable `exp`. Only used to time the "session ending" prompt — the
 * server verifies the signature; nothing here is trusted for access decisions.
 */
export function tokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Whole minutes left (rounded up, at least 1) for the prompt's wording. */
export function minutesLeft(expiryMs: number, now: number): number {
  return Math.max(1, Math.ceil((expiryMs - now) / 60_000));
}
