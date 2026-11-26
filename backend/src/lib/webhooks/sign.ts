// Standard Webhooks signing (https://www.standardwebhooks.com/): the
// signature is HMAC-SHA256 over `${id}.${timestamp}.${body}`, keyed with the
// base64 part of the `whsec_` secret, sent as `v1,<base64>`.
import crypto from "node:crypto";

export const SECRET_PREFIX = "whsec_";

/** A fresh secret: `whsec_` + base64 of 24 random bytes. */
export function generateSecret(): string {
  return `${SECRET_PREFIX}${crypto.randomBytes(24).toString("base64")}`;
}

function keyOf(secret: string): Buffer {
  return Buffer.from(secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret, "base64");
}

/** The `webhook-signature` header value for one request. `timestamp` is unix seconds. */
export function signStandardWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const digest = crypto.createHmac("sha256", keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${digest}`;
}

export function standardHeaders(secret: string, id: string, timestamp: number, body: string): Record<string, string> {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signStandardWebhook(secret, id, timestamp, body),
  };
}
