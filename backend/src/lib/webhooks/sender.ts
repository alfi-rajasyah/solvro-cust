// One outgoing webhook request: policy check, pinned connection, 10 s
// timeout, no redirects. The response body is never read, stored or logged
// (it is dropped as soon as the status line arrives), and an error text is a
// short fixed code, never the remote's own words.
import http from "node:http";
import https from "node:https";
import { open } from "../secretBox.js";
import type { WebhookPayload } from "./payload.js";
import { standardHeaders } from "./sign.js";
import { pinnedLookup, resolveTarget, WebhookTargetError, type TargetPolicy } from "./validateTarget.js";

export const SEND_TIMEOUT_MS = 10_000;

export interface SendResult {
  ok: boolean;
  statusCode: number | null;
  /** Short code such as `timeout`, `connection_failed`, `http_503`, `target_private`; null on success. */
  error: string | null;
  /** A network error, a timeout, 429 or 5xx can succeed later; any other failure cannot. */
  retryable: boolean;
}

export interface PreparedRequest {
  headers: Record<string, string>;
  body: string;
}

export interface WebhookTargetFields {
  secretEnc: string;
}

/** The body and headers for one send. Throws if the webhook's secret cannot be opened. */
export function prepareRequest(
  sub: WebhookTargetFields,
  deliveryId: string,
  payload: WebhookPayload,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): PreparedRequest {
  const base = { "content-type": "application/json", "user-agent": "Solvro-Webhooks/1" };
  const body = JSON.stringify(payload);
  return { headers: { ...base, ...standardHeaders(open(sub.secretEnc), deliveryId, nowSeconds, body) }, body };
}

export async function sendRequest(
  rawUrl: string,
  request: PreparedRequest,
  options: TargetPolicy & { timeoutMs?: number } = {},
): Promise<SendResult> {
  let target;
  try {
    target = await resolveTarget(rawUrl, options);
  } catch (err) {
    if (err instanceof WebhookTargetError) {
      return { ok: false, statusCode: null, error: `target_${err.reason}`, retryable: err.reason === "unresolvable" };
    }
    throw err;
  }
  const { url, address, family } = target;
  const transport = url.protocol === "https:" ? https : http;
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;

  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const finish = (result: SendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...request.headers, "content-length": String(Buffer.byteLength(request.body)) },
        agent: false,
        lookup: pinnedLookup(address, family),
      } as https.RequestOptions,
      (res) => {
        const code = res.statusCode ?? 0;
        res.destroy(); // the body is never read
        if (code >= 200 && code < 300) return finish({ ok: true, statusCode: code, error: null, retryable: false });
        finish({ ok: false, statusCode: code, error: `http_${code}`, retryable: code === 429 || code >= 500 });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, statusCode: null, error: "timeout", retryable: true });
    }, timeoutMs);
    timer.unref?.();
    req.on("error", () => finish({ ok: false, statusCode: null, error: "connection_failed", retryable: true }));
    req.end(request.body);
  });
}

/** Test seam: the dispatcher and the test route call the real sender unless a test swaps it. */
export type SendFn = typeof sendRequest;
