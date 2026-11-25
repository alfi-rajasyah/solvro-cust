// Address policy for webhook targets (docs/archive/plans/webhooks.md). Checked
// when a webhook is saved and again before every send, where the request then
// connects to the address that was checked (a pinned lookup), so a name that
// later resolves to a private address (DNS rebinding) cannot reach it.
import dns from "node:dns";
import net from "node:net";
import { env } from "../../env.js";
import { HttpError } from "../../http/errors.js";
import { isPrivateAddress, type Lookup } from "../itop/validateBaseUrl.js";

export type TargetRefusal = "invalid" | "scheme" | "userinfo" | "private" | "unresolvable";

/** 400 `webhook_target_refused`; `reason` tells the sender whether a retry can help (only `unresolvable`). */
export class WebhookTargetError extends HttpError {
  constructor(
    public readonly reason: TargetRefusal,
    message: string,
  ) {
    super(400, "webhook_target_refused", message);
  }
}

export interface TargetPolicy {
  allowHttp?: boolean;
  allowPrivate?: boolean;
  lookup?: Lookup;
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

const defaultLookup: Lookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

function isLocalName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".");
}

/** The URL's host without the query string or path, safe to log. */
export function hostForLog(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return "invalid-url";
  }
}

/** Parses and checks the scheme and userinfo rules; no network. */
export function parseTarget(raw: string, policy: TargetPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookTargetError("invalid", "The URL is not valid");
  }
  const allowHttp = policy.allowHttp ?? env.WEBHOOK_ALLOW_HTTP;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new WebhookTargetError("scheme", "The URL must start with https://");
  }
  if (url.username !== "" || url.password !== "") {
    throw new WebhookTargetError("userinfo", "The URL must not contain a user name or password");
  }
  return url;
}

/**
 * Full policy check, and the address a send must connect to. Unless private
 * hosts are allowed, every address the name resolves to must be public.
 */
export async function resolveTarget(raw: string, policy: TargetPolicy = {}): Promise<ResolvedTarget> {
  const url = parseTarget(raw, policy);
  const allowPrivate = policy.allowPrivate ?? env.WEBHOOK_ALLOW_PRIVATE_HOSTS;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const privateRefusal = () =>
    new WebhookTargetError("private", "The URL points at a private, loopback or local address, which this deployment does not allow");

  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateAddress(host)) throw privateRefusal();
    return { url, address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  if (!allowPrivate && isLocalName(host)) throw privateRefusal();

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await (policy.lookup ?? defaultLookup)(host);
  } catch {
    throw new WebhookTargetError("unresolvable", "The host name could not be resolved");
  }
  if (addresses.length === 0) throw new WebhookTargetError("unresolvable", "The host name could not be resolved");
  if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) throw privateRefusal();
  const first = addresses[0];
  return { url, address: first.address, family: net.isIPv6(first.address) ? 6 : 4 };
}

/** Save-time check: throws 400 `webhook_target_refused` or returns. */
export async function assertWebhookTarget(raw: string, policy: TargetPolicy = {}): Promise<void> {
  await resolveTarget(raw, policy);
}

/**
 * A `lookup` for node:http(s).request that always answers with the address
 * already checked, whatever name the request asks for. Handles both the
 * single-address and the `all: true` calling conventions.
 */
export function pinnedLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
  ): void => {
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}
