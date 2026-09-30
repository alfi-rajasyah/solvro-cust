// `TRUST_PROXY` (src/env.ts) -> the value handed to `app.set("trust proxy", …)`.
// Deliberately narrower than Express: a bare "true" trusts every X-Forwarded-For
// hop, which lets any client spoof its address, so it is rejected.

import express from "express";

export type TrustProxySetting = number | string;

const NAMED = new Set(["loopback", "linklocal", "uniquelocal"]);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/;
const IPV6 = /^[0-9a-fA-F:.]*:[0-9a-fA-F:.]*(\/\d{1,3})?$/;
const MAX_HOPS = 10;

/**
 * Accepts a hop count ("0" to "10") or a comma-separated list of Express
 * trust names (loopback, linklocal, uniquelocal) and IPv4/IPv6 addresses or
 * CIDR subnets. Returns null when the value is not one of those.
 */
export function parseTrustProxy(raw: string): TrustProxySetting | null {
  const value = raw.trim();
  if (value === "") return null;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops <= MAX_HOPS ? hops : null;
  }
  const entries = value.split(",").map((e) => e.trim()).map((e) => (NAMED.has(e.toLowerCase()) ? e.toLowerCase() : e));
  const ok = entries.every((e) => NAMED.has(e) || IPV4.test(e) || IPV6.test(e));
  if (!ok) return null;
  const setting = entries.join(", ");
  // Let Express have the last word: an address it cannot compile (999.1.1.1)
  // must fail here, at config time, not at the first request.
  try {
    express().set("trust proxy", setting);
  } catch {
    return null;
  }
  return setting;
}
