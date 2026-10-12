// Typed failures of calls to Outline (docs/archive/plans/outline-integration.md,
// B3). Every one is an HttpError so an uncaught one renders as a clean
// `{ error, code }` — never Outline's own message or body, which can carry page
// text (D4). None of them uses 401 (the frontend signs the user out on a 401)
// and none maps Outline's 403 to a Solvro 403.
import { HttpError } from "../../http/errors.js";

export type OutlineErrorKind =
  | "not_connected" // the user has not connected Outline
  | "not_configured" // Outline refused Solvro's OAuth client (id/secret): an admin problem, tokens are kept
  | "reconnect_required" // tokens gone / refused: the user must connect again
  | "forbidden" // Outline 403: the page/collection is hidden from this user (F7)
  | "not_found" // Outline 404 (F7: treat like forbidden for visibility)
  | "rate_limited" // Outline 429 (F11)
  | "rejected" // Outline 400/422: Solvro sent something Outline refused
  | "unavailable"; // network error, timeout, redirect, 5xx

export class OutlineApiError extends HttpError {
  kind: OutlineErrorKind;
  constructor(kind: OutlineErrorKind, status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.kind = kind;
  }
}

export const outlineNotConnected = () =>
  new OutlineApiError("not_connected", 409, "outline_not_connected", "Connect your Outline account first.");

export const outlineNotConfigured = () =>
  new OutlineApiError(
    "not_configured",
    409,
    "outline_not_configured",
    "Outline did not accept Solvro's OAuth client. An administrator must check the Outline settings.",
  );

export const outlineReconnectRequired = () =>
  new OutlineApiError(
    "reconnect_required",
    409,
    "outline_reconnect_required",
    "Your Outline connection has expired. Connect Outline again.",
  );

export const outlineForbidden = () =>
  new OutlineApiError("forbidden", 404, "outline_forbidden", "Outline does not let you open this page.");

export const outlineNotFound = () =>
  new OutlineApiError("not_found", 404, "outline_not_found", "Outline could not find this page.");

export const outlineRateLimited = (retryAfter: number | null) =>
  new OutlineApiError("rate_limited", 429, "outline_rate_limited", "Outline is busy. Try again shortly.", {
    retryAfter,
  });

export const outlineRejected = () =>
  new OutlineApiError("rejected", 502, "outline_rejected", "Outline refused the request.");

export const outlineUnavailable = () =>
  new OutlineApiError("unavailable", 502, "outline_unavailable", "Outline could not be reached.");

/** True when Outline says this user cannot open the thing (403 or 404, F7). */
export function isOutlineHidden(err: unknown): boolean {
  return err instanceof OutlineApiError && (err.kind === "forbidden" || err.kind === "not_found");
}
