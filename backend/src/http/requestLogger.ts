import type { IncomingMessage } from "node:http";
import { stdSerializers, type Logger } from "pino";
import { pinoHttp } from "pino-http";

// Request logging with secrets scrubbed. Three things must never reach a log:
//  - the Authorization header (a bearer JWT, valid for JWT_EXPIRES_IN);
//  - any other secret-bearing header: the iTop webhook secret
//    (X-Solvro-Webhook-Secret) and cookies;
//  - a guest-link token (GET /public/share/<token>, and the page URL
//    /share/<token> that shows up in a Referer) — anyone reading the logs
//    could otherwise open the link.

const SHARE_TOKEN_IN_PATH = /(\/share\/)[^/?#\s"']+/gi;

/** Header names (lower-case, as pino's serializer emits them) whose value is masked. */
const SECRET_HEADERS = ["authorization", "x-solvro-webhook-secret", "cookie", "set-cookie"] as const;

/** Replaces the token segment of any `/share/<token>` (page or API path). */
export function redactShareTokens(text: string): string {
  return text.replace(SHARE_TOKEN_IN_PATH, "$1[redacted]");
}

type SerializedReq = ReturnType<typeof stdSerializers.req>;

/**
 * pino-http hands a custom `serializers.req` the request ALREADY run through
 * pino's standard serializer (id, method, url, headers, remoteAddress, …), so
 * this only copies that object and redacts on the copy — serializing again
 * would find no socket and drop remoteAddress/remotePort from every line.
 */
export function redactSerializedRequest(s: SerializedReq): SerializedReq {
  const headers = { ...s.headers } as Record<string, unknown>;
  for (const name of SECRET_HEADERS) {
    if (headers[name] !== undefined) headers[name] = "[redacted]";
  }
  for (const name of ["referer", "referrer"]) {
    const v = headers[name];
    if (typeof v === "string") headers[name] = redactShareTokens(v);
  }
  return { ...s, url: redactShareTokens(String(s.url ?? "")), headers } as SerializedReq;
}

type SerializedRes = ReturnType<typeof stdSerializers.res>;

/**
 * Same masking for the RESPONSE headers pino-http logs (`Set-Cookie` only ever
 * appears there; no route sets one today, so this guards a future one).
 */
export function redactSerializedResponse(s: SerializedRes): SerializedRes {
  if (!s.headers) return s;
  const headers = { ...s.headers } as Record<string, unknown>;
  for (const name of SECRET_HEADERS) {
    if (headers[name] !== undefined) headers[name] = "[redacted]";
  }
  return { ...s, headers } as SerializedRes;
}

export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    serializers: { req: redactSerializedRequest, res: redactSerializedResponse },
    // The address `req.ip` resolves to under TRUST_PROXY — what the public
    // share rate limiter keys on. `remoteAddress` alone is the proxy behind nginx.
    customProps: (req) => ({ clientIp: (req as IncomingMessage & { ip?: string }).ip }),
  });
}
