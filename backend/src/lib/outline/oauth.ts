// Outline OAuth plumbing (docs/archive/plans/outline-integration.md, B3, F1-F4).
// Solvro is an OAuth client of the deployment's own Outline: each user connects
// their own account and every Outline call runs under THAT user's token (D2 and
// the Guardrail "Outline calls never use an application token"). This file talks
// only to Outline's /oauth endpoints, which take form-encoded bodies (JSON is a
// 400) and are rate-limited per client IP (F11). Response bodies are never logged.
import crypto from "node:crypto";
import { prisma } from "../../prisma.js";
import { HttpError } from "../../http/errors.js";
import { logger } from "../../logger.js";
import { open, SecretBoxError } from "../secretBox.js";
import { requireAppUrl } from "./requireAppUrl.js";
import { outlineRedirectUri } from "./appUrl.js";
import { outlineNotConfigured, outlineRateLimited, outlineUnavailable } from "./errors.js";

export const OUTLINE_OAUTH_SCOPE = "read create"; // F2: covers every Phase B call, nothing writes/deletes
export const OAUTH_TIMEOUT_MS = 10_000;

export interface OutlineOAuthConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

/** The admin-registered OAuth client, or null while any part is missing. */
export async function loadOutlineOAuthConfig(): Promise<OutlineOAuthConfig | null> {
  const row = await prisma.outlineConfig.findUnique({
    where: { id: "default" },
    select: { baseUrl: true, oauthClientId: true, oauthClientSecretEnc: true },
  });
  if (!row?.baseUrl || !row.oauthClientId || !row.oauthClientSecretEnc) return null;
  try {
    return { baseUrl: row.baseUrl, clientId: row.oauthClientId, clientSecret: open(row.oauthClientSecretEnc) };
  } catch (err) {
    // A secret sealed under another SECRETS_KEY can't be read: treat Outline as not configured
    // (disconnect and /outline/me must keep working), the admin re-enters the secret.
    if (err instanceof SecretBoxError) {
      logger.warn("outline client secret could not be decrypted; treating Outline as not configured");
      return null;
    }
    throw err;
  }
}

export async function requireOutlineOAuthConfig(): Promise<OutlineOAuthConfig> {
  const config = await loadOutlineOAuthConfig();
  if (!config) {
    throw new HttpError(
      409,
      "outline_not_configured",
      "An administrator must finish the Outline setup (address, client id and secret) first.",
    );
  }
  return config;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** RFC 7636 S256 pair; the verifier is 256 random bits. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

/** A single-use OAuth state id: 256 random bits. */
export function createStateId(): string {
  return b64url(crypto.randomBytes(32));
}

export function buildAuthorizeUrl(config: OutlineOAuthConfig, state: string, challenge: string): string {
  const url = new URL(`${config.baseUrl}/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", outlineRedirectUri(requireAppUrl()));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OUTLINE_OAUTH_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface OutlineTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Outline refused the code/refresh token (expired, replayed, revoked grant). */
export class OutlineGrantError extends Error {
  constructor() {
    super("invalid_grant");
    this.name = "OutlineGrantError";
  }
}

async function postForm(
  config: OutlineOAuthConfig,
  path: string,
  params: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> | null; retryAfter: number | null }> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch {
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

function parseTokenResponse(json: Record<string, unknown> | null): OutlineTokenPair {
  const access = json?.access_token;
  const refresh = json?.refresh_token;
  const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : 3600;
  if (typeof access !== "string" || typeof refresh !== "string" || access === "" || refresh === "") {
    throw outlineUnavailable();
  }
  return { accessToken: access, refreshToken: refresh, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

async function tokenRequest(config: OutlineOAuthConfig, params: Record<string, string>): Promise<OutlineTokenPair> {
  const { status, json, retryAfter } = await postForm(config, "/oauth/token", {
    ...params,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (status === 429) throw outlineRateLimited(retryAfter);
  if (status >= 200 && status < 300) return parseTokenResponse(json);
  const oauthError = typeof json?.error === "string" ? json.error : "";
  // ONLY invalid_grant says the code/refresh token itself is no good (clear the tokens).
  if (oauthError === "invalid_grant") throw new OutlineGrantError();
  // Outline refused Solvro's client credentials: an admin problem - the users' tokens are fine, keep them.
  if (oauthError === "invalid_client" || oauthError === "unauthorized_client") throw outlineNotConfigured();
  // Anything else (other 4xx, 5xx, malformed answers) is a transient/upstream failure.
  throw outlineUnavailable();
}

/** Authorization-code exchange with the PKCE verifier (F1). */
export function exchangeAuthorizationCode(
  config: OutlineOAuthConfig,
  code: string,
  verifier: string,
): Promise<OutlineTokenPair> {
  return tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: outlineRedirectUri(requireAppUrl()),
    code_verifier: verifier,
  });
}

/** Refresh-token grant. Rotates BOTH tokens (F4) - the caller must store the new pair. */
export function refreshTokenGrant(config: OutlineOAuthConfig, refreshToken: string): Promise<OutlineTokenPair> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/**
 * RFC 7009 revoke, best effort: revoking the refresh token kills the access/refresh
 * pair at Outline. Never throws - a failed revoke must not block a disconnect or a
 * refused connection (the tokens are dropped locally either way).
 */
export async function revokeToken(config: OutlineOAuthConfig, token: string): Promise<void> {
  try {
    await postForm(config, "/oauth/revoke", {
      token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
  } catch {
    // best effort
  }
}
