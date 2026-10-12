// A minimal in-process stand-in for Outline's OAuth + API surface, shaped by the
// real-instance spike findings (docs/archive/plans/outline-integration.md F1-F5):
// form-encoded /oauth/token and /oauth/revoke, rotating refresh tokens, replayed
// refresh token => invalid_grant, JSON /api/<method> with a Bearer token.
import http from "node:http";
import type { AddressInfo } from "node:net";

interface Identity {
  id: string;
  email: string;
}

type ApiOverride = { status: number; body?: unknown; headers?: Record<string, string> };

export interface OutlineStub {
  url: string;
  close: () => Promise<void>;
  /** Registers an authorization code that exchanges for tokens of this Outline user. */
  issueCode: (code: string, who: Identity) => void;
  /** Every /oauth/token request body, parsed. */
  tokenRequests: URLSearchParams[];
  revokeRequests: URLSearchParams[];
  /** Every /api call: method, bearer token and JSON body. */
  apiCalls: Array<{ method: string; token: string; body: unknown }>;
  /** Makes an issued access token answer 401 from now on (expired/revoked). */
  invalidateAccess: (token: string) => void;
  /** Makes the next refresh with a token fail with invalid_grant (revoked grant). */
  revokeRefresh: (token: string) => void;
  /** Delay (ms) added to /oauth/token refresh answers, to widen race windows. */
  refreshDelayMs: number;
  /** Delay (ms) added to /oauth/token authorization_code answers. */
  exchangeDelayMs: number;
  /** Optional override for /oauth/token: return a status+body, or undefined for the default. */
  token: (params: URLSearchParams) => { status: number; body: unknown } | undefined;
  /** Optional override for /api/<method>: return a status+body, or undefined for the default. */
  api: (
    method: string,
    token: string,
    body: unknown,
  ) => ApiOverride | undefined | Promise<ApiOverride | undefined>;
  /** The last access/refresh pair issued. */
  lastIssued: () => { accessToken: string; refreshToken: string } | null;
}

export async function startOutlineStub(opts: { clientId: string; clientSecret: string }): Promise<OutlineStub> {
  let counter = 0;
  const codes = new Map<string, Identity>();
  const access = new Map<string, Identity>(); // valid access tokens
  const refresh = new Map<string, Identity>(); // valid refresh tokens
  let last: { accessToken: string; refreshToken: string } | null = null;

  const stub: OutlineStub = {
    url: "",
    close: async () => undefined,
    issueCode: (code, who) => void codes.set(code, who),
    tokenRequests: [],
    revokeRequests: [],
    apiCalls: [],
    invalidateAccess: (t) => void access.delete(t),
    revokeRefresh: (t) => void refresh.delete(t),
    refreshDelayMs: 0,
    exchangeDelayMs: 0,
    token: () => undefined,
    api: () => undefined,
    lastIssued: () => last,
  };

  function issue(who: Identity) {
    counter += 1;
    const pair = { accessToken: `ol_at_${counter}`, refreshToken: `ol_rt_${counter}` };
    access.set(pair.accessToken, who);
    refresh.set(pair.refreshToken, who);
    last = pair;
    return { access_token: pair.accessToken, refresh_token: pair.refreshToken, expires_in: 3600, token_type: "Bearer" };
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, { "Content-Type": "application/json", ...headers });
          res.end(JSON.stringify(body));
        };
        const path = req.url ?? "";
        if (path === "/oauth/token" || path === "/oauth/revoke") {
          if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
            return send(400, { error: "invalid_request" });
          }
          const p = new URLSearchParams(raw);
          if (p.get("client_id") !== opts.clientId || p.get("client_secret") !== opts.clientSecret) {
            return send(401, { error: "invalid_client" });
          }
          if (path === "/oauth/revoke") {
            stub.revokeRequests.push(p);
            const t = p.get("token") ?? "";
            const who = refresh.get(t) ?? access.get(t);
            if (who) {
              for (const [k, v] of refresh) if (v === who) refresh.delete(k);
              for (const [k, v] of access) if (v === who) access.delete(k);
            }
            return send(200, {});
          }
          stub.tokenRequests.push(p);
          const forced = stub.token(p);
          if (forced) return send(forced.status, forced.body);
          if (p.get("grant_type") === "authorization_code") {
            if (stub.exchangeDelayMs > 0) await new Promise((r) => setTimeout(r, stub.exchangeDelayMs));
            const who = codes.get(p.get("code") ?? "");
            if (!who || !p.get("code_verifier")) return send(400, { error: "invalid_grant" });
            codes.delete(p.get("code")!); // single use
            return send(200, issue(who));
          }
          if (p.get("grant_type") === "refresh_token") {
            if (stub.refreshDelayMs > 0) await new Promise((r) => setTimeout(r, stub.refreshDelayMs));
            const t = p.get("refresh_token") ?? "";
            const who = refresh.get(t);
            if (!who) return send(400, { error: "invalid_grant" });
            // Rotation (F4): the old pair is dead at once.
            refresh.delete(t);
            for (const [k, v] of access) if (v === who) access.delete(k);
            return send(200, issue(who));
          }
          return send(400, { error: "unsupported_grant_type" });
        }
        if (path.startsWith("/api/")) {
          const method = path.slice(5);
          const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
          const body: unknown = raw ? JSON.parse(raw) : {};
          stub.apiCalls.push({ method, token, body });
          const override = await stub.api(method, token, body);
          if (override) return send(override.status, override.body ?? {}, override.headers);
          const who = access.get(token);
          if (!who) return send(401, { ok: false, error: "authentication_required" });
          if (method === "auth.info") return send(200, { ok: true, data: { user: { id: who.id, name: "N", email: who.email, role: "member" } } });
          return send(200, { ok: true, data: { echoed: method } });
        }
        send(404, { error: "not_found" });
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stub.close = () => new Promise((resolve) => server.close(() => resolve()));
  return stub;
}
