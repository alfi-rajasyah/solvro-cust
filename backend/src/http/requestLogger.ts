import type { IncomingMessage } from "node:http";
import { stdSerializers, type Logger } from "pino";
import { pinoHttp } from "pino-http";

// Request logging with secrets scrubbed. Two things must never reach a log:
//  - a guest-link token (GET /public/share/<token>, and the page URL
//    /share/<token> that shows up in a Referer) — anyone reading the logs
//    could otherwise open the link;
//  - the Authorization header (a bearer JWT).

const SHARE_TOKEN_IN_PATH = /(\/share\/)[^/?#\s"']+/gi;

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
  if (headers.authorization !== undefined) headers.authorization = "[redacted]";
  for (const name of ["referer", "referrer"]) {
    const v = headers[name];
    if (typeof v === "string") headers[name] = redactShareTokens(v);
  }
  return { ...s, url: redactShareTokens(String(s.url ?? "")), headers } as SerializedReq;
}

export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    serializers: { req: redactSerializedRequest },
    // The address `req.ip` resolves to under TRUST_PROXY — what the public
    // share rate limiter keys on. `remoteAddress` alone is the proxy behind nginx.
    customProps: (req) => ({ clientIp: (req as IncomingMessage & { ip?: string }).ip }),
  });
}
