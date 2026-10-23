// Host policy for the admin-configured iTop address (routes/itopAdmin.ts,
// PATCH /settings and POST /test). The backend sends every iTop request to
// whatever address an admin stores, so without this an admin session could
// aim the server at loopback, link-local or private addresses and read the
// probe results (status, JSON shape, iTop's own error text) as a scan of the
// internal network. An https:// origin without userinfo is always required.
// The public-address check is OFF by default (ITOP_ALLOW_PRIVATE_HOSTS, src/env.ts,
// default true — user decision 2026-10-22: Solvro and iTop share a LAN, so the
// iTop address is normally a `.local` name or an RFC1918 address) and is
// switched on with ITOP_ALLOW_PRIVATE_HOSTS=false for an internet-facing
// deployment whose iTop is public.
//
// Residual, documented: the check resolves the name once at save/test time.
// A name that resolves to a public address now and to a private one later
// (DNS rebinding) is not caught; pinning the resolved address into the client
// would be the next step if that threat ever matters here.
import dns from "node:dns";
import net from "node:net";
import { env } from "../../env.js";
import { HttpError } from "../../http/errors.js";

export type Lookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: Lookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** True for loopback, unspecified, link-local, RFC1918, CGNAT, ULA and IPv4-mapped forms of those. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().split("%")[0];
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (!net.isIPv6(ip)) return true; // not an address at all: refuse
  if (ip === "::" || ip === "::1") return true;
  // IPv4-mapped / IPv4-compatible (::ffff:a.b.c.d, ::a.b.c.d, ::ffff:xxxx:xxxx)
  const mapped = /^(?:0*:)*(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const hexMapped = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(ip.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** `localhost`, `*.localhost`, `*.local`, `*.internal` and single-label names never leave the host or the LAN (checked only when private hosts are refused). */
function isLocalName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".");
}

/**
 * Throws 400 `itop_url_invalid` unless `raw` is an https:// URL without
 * userinfo; with the public-address check on (ITOP_ALLOW_PRIVATE_HOSTS=false),
 * also 400 `itop_url_private` unless the host is a public name or address.
 * A name that does not resolve is allowed through: the later request simply
 * fails, and refusing here would block saving the address while iTop is down.
 */
export async function assertPublicItopUrl(
  raw: string,
  opts: { lookup?: Lookup; allowPrivate?: boolean } = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "itop_url_invalid", "baseUrl must be an https:// URL");
  }
  if (url.protocol !== "https:") {
    throw new HttpError(400, "itop_url_invalid", "baseUrl must be an https:// URL");
  }
  if (url.username !== "" || url.password !== "") {
    throw new HttpError(400, "itop_url_invalid", "baseUrl must not contain a user name or password");
  }
  const allowPrivate = opts.allowPrivate ?? env.ITOP_ALLOW_PRIVATE_HOSTS;
  if (allowPrivate) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const refuse = () =>
    new HttpError(
      400,
      "itop_url_private",
      "baseUrl points at a private, loopback or local address. This deployment accepts only a public iTop address (ITOP_ALLOW_PRIVATE_HOSTS=false on the backend).",
    );
  if (isLocalName(host)) throw refuse();
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw refuse();
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    return; // unresolvable now: nothing to probe; the request itself will fail
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) throw refuse();
}
