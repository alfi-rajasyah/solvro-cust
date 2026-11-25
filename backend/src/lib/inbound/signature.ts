// Optional Standard Webhooks check for an incoming URL
// (docs/archive/plans/webhooks.md, Phase 2): reuses the signer the outgoing
// side uses, so Solvro verifies exactly what Solvro sends.
import crypto from "node:crypto";
import { signStandardWebhook } from "../webhooks/sign.js";

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface StandardHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type SignatureVerdict = "ok" | "missing" | "stale" | "mismatch";

/**
 * `body` is the exact received text. Any one of the space-separated `v1,`
 * signatures may match; each comparison is constant time.
 */
export function verifyStandardWebhook(secret: string, headers: StandardHeaders, body: string, nowMs: number = Date.now()): SignatureVerdict {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return "missing";
  const ts = Number(timestamp);
  if (Math.abs(nowMs / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) return "stale";
  const expected = Buffer.from(signStandardWebhook(secret, id, ts, body), "utf8");
  let matched = false;
  for (const candidate of signature.split(" ")) {
    if (!candidate.startsWith("v1,")) continue;
    const given = Buffer.from(candidate, "utf8");
    // Length differs only for a malformed entry; a real one always compares.
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) matched = true;
  }
  return matched ? "ok" : "mismatch";
}
