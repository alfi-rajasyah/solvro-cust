// Incoming webhook URL tokens (docs/archive/plans/webhooks.md, Phase 2).
// The token is the secret part of the URL path. Only its SHA-256 hash is
// stored, and the incoming route looks a hook up by that hash.
import crypto from "node:crypto";

/** Path segment under which incoming URLs live, behind the `/webhook` mount. */
export const INBOUND_PATH = "/webhook/in/";

export interface NewInboundToken {
  /** The raw token: shown to the user once, never stored. */
  token: string;
  /** SHA-256 hex of the token, stored in `InboundHook.tokenHash`. */
  hash: string;
  /** The first 4 characters, stored in `InboundHook.tokenPreview` for the list. */
  preview: string;
}

/** A fresh token: 32 random bytes in base64url (43 characters). */
export function generateInboundToken(): NewInboundToken {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashInboundToken(token), preview: token.slice(0, 4) };
}

export function hashInboundToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** The full URL a tool posts to, or null without `APP_URL`. */
export function inboundUrl(appUrl: string | undefined, token: string): string | null {
  if (!appUrl) return null;
  return `${appUrl.replace(/\/+$/, "")}/api${INBOUND_PATH}${token}`;
}
