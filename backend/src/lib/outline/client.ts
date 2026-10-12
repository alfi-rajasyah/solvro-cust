// The Outline API client (docs/archive/plans/outline-integration.md, B3).
// `outlineCall(userId, method, body)` is the ONLY way Solvro talks to Outline's
// /api: it authenticates with that user's own OAuth token (D2 - there is no
// application/admin key anywhere in Solvro and none may be added), refreshes it
// when needed, and maps failures to typed errors (lib/outline/errors.ts). Response
// bodies can hold page text (D4), so they are never logged.
import { prisma } from "../../prisma.js";
import { logger } from "../../logger.js";
import { HttpError } from "../../http/errors.js";
import { getOutlineAccessToken, clearOutlineTokensIfAccessIs } from "./tokens.js";
import {
  outlineForbidden,
  outlineNotFound,
  outlineRateLimited,
  outlineReconnectRequired,
  outlineRejected,
  outlineUnavailable,
} from "./errors.js";

export const OUTLINE_API_TIMEOUT_MS = 10_000;
const METHOD = /^[A-Za-z]+\.[A-Za-z]+$/;

export interface RawOutlineResponse {
  status: number;
  json: Record<string, unknown> | null;
  retryAfter: number | null;
}

/**
 * One POST to `{baseUrl}/api/<method>` with the given bearer token and nothing
 * more: no refresh, no status mapping. Exported for the OAuth callback, which
 * must call `auth.info` with a token that is not stored yet.
 */
export async function rawOutlineCall(
  baseUrl: string,
  accessToken: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<RawOutlineResponse> {
  if (!METHOD.test(method)) throw new Error(`Invalid Outline method "${method}"`);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(OUTLINE_API_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ method, reason: err instanceof Error ? err.name : "error" }, "outline request failed");
    throw outlineUnavailable();
  }
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null) json = parsed as Record<string, unknown>;
  } catch {
    json = null;
  }
  const ra = Number(res.headers.get("retry-after"));
  return { status: res.status, json, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
}

/** Maps a non-2xx Outline answer (other than 401, handled by the caller) to a typed error. */
function throwForStatus(r: RawOutlineResponse): never {
  if (r.status === 403) throw outlineForbidden();
  if (r.status === 404) throw outlineNotFound();
  if (r.status === 429) throw outlineRateLimited(r.retryAfter);
  if (r.status === 400 || r.status === 422) throw outlineRejected();
  throw outlineUnavailable();
}

/**
 * Calls an Outline API method as `userId`. Returns Outline's parsed JSON
 * (`{ ok, data, pagination? }`). 401 => one forced refresh and one retry; a second
 * 401 drops the stored tokens and throws 409 `outline_reconnect_required`.
 * 429 is surfaced as `outline_rate_limited` with `retryAfter` - never retried (F11).
 */
export async function outlineCall<T = Record<string, unknown>>(
  userId: number,
  method: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const config = await prisma.outlineConfig.findUnique({ where: { id: "default" }, select: { baseUrl: true } });
  if (!config?.baseUrl) {
    throw new HttpError(409, "outline_not_configured", "An administrator must set the Outline address first.");
  }

  let token = await getOutlineAccessToken(userId);
  let r = await rawOutlineCall(config.baseUrl, token, method, body);
  if (r.status === 401) {
    token = await getOutlineAccessToken(userId, { rejectedAccessToken: token });
    // The address may have changed while the refresh ran (the admin's change wipes every
    // token): never send the refreshed token anywhere but the host it was issued for.
    const again = await prisma.outlineConfig.findUnique({ where: { id: "default" }, select: { baseUrl: true } });
    if (again?.baseUrl !== config.baseUrl) throw outlineReconnectRequired();
    r = await rawOutlineCall(config.baseUrl, token, method, body);
    if (r.status === 401) {
      // Only drop the pair that just failed - a newer one (a fresh connection) must survive.
      await clearOutlineTokensIfAccessIs(userId, token);
      throw outlineReconnectRequired();
    }
  }
  if (r.status < 200 || r.status >= 300) throwForStatus(r);
  return (r.json ?? {}) as T;
}
