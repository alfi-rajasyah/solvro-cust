// Shared Zod helper for an Outline link (Customer.outlineUrl,
// Project.outlineUrl, OutlineConfig.baseUrl): trimmed, "" and null clear it,
// http(s) only, at most 2048 characters. The scheme check matters — the value
// is rendered as an <a href> in the app, so `javascript:`/`data:` must never
// get stored (docs/archive/plans/outline-integration.md §3).
import { z } from "zod";

export const OUTLINE_URL_MAX_LENGTH = 2048;

function hasHttpScheme(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function hasUserinfo(value: string): boolean {
  try {
    const { username, password } = new URL(value);
    return username !== "" || password !== "";
  } catch {
    return false;
  }
}

/**
 * A note for the admin when the Outline address is plain http: allowed for LAN
 * deployments, but sign-in tokens and page text then cross the network unencrypted.
 */
export function outlineBaseUrlWarning(baseUrl: string | null): string | null {
  if (baseUrl === null) return null;
  try {
    if (new URL(baseUrl).protocol === "http:") {
      return "The Outline address uses http, so Outline traffic is not encrypted. Use https unless Outline is only reachable on a trusted network.";
    }
  } catch {
    return null;
  }
  return null;
}

export const outlineUrlSchema = z.string().nullable().transform((raw, ctx) => {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === "") return null;
  if (value.length > OUTLINE_URL_MAX_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Outline URL must be at most ${OUTLINE_URL_MAX_LENGTH} characters`,
    });
    return z.NEVER;
  }
  // `new URL()` silently skips leading control characters, and Postgres
  // rejects NUL — refuse them here so they never reach the database.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Outline URL must not contain control characters",
    });
    return z.NEVER;
  }
  if (!hasHttpScheme(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Outline URL must be an http:// or https:// URL",
    });
    return z.NEVER;
  }
  // A login in the link would be stored and rendered as an <a href> to every viewer.
  if (hasUserinfo(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Outline URL must not contain a user name or password",
    });
    return z.NEVER;
  }
  return value;
});
