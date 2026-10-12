// Verification of Outline's webhook signature (docs/archive/plans/outline-integration.md,
// F10): header `Outline-Signature: t=<ms>,s=<hex>` where s = HMAC-SHA256(secret,
// `${t}.${rawBody}`) and `t` is in MILLISECONDS. Outline sends no header at all
// when the subscription has no secret, so a missing header is a rejection.
// Pure (no env / no DB) so it is unit-testable; never logs.
import crypto from "node:crypto";

/** Outline's clock and ours may drift; a delivery older/newer than this is refused. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

export type SignatureVerdict = "ok" | "malformed" | "mismatch" | "stale";

/** Parses `t=<ms>,s=<hex>`; null on anything else (extra keys are ignored). */
export function parseSignatureHeader(header: string): { t: string; s: Buffer } | null {
  let t: string | undefined;
  let s: string | undefined;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && t === undefined) t = value;
    else if (key === "s" && s === undefined) s = value;
  }
  if (t === undefined || s === undefined) return null;
  if (!/^\d{1,16}$/.test(t) || !/^[0-9a-f]{64}$/i.test(s)) return null;
  return { t, s: Buffer.from(s, "hex") };
}

export function verifyOutlineSignature(
  header: string,
  rawBody: Buffer,
  secret: string,
  now: number = Date.now(),
): SignatureVerdict {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return "malformed";
  const expected = crypto.createHmac("sha256", secret).update(`${parsed.t}.`).update(rawBody).digest();
  // Both are 32 bytes (the regex above fixes the hex length), as timingSafeEqual requires.
  if (parsed.s.length !== expected.length || !crypto.timingSafeEqual(parsed.s, expected)) return "mismatch";
  if (Math.abs(now - Number(parsed.t)) > WEBHOOK_TOLERANCE_MS) return "stale";
  return "ok";
}
