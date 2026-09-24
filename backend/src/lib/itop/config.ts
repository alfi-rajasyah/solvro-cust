import { Prisma, type ItopConfig } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { logger } from "../../logger.js";
import { HttpError } from "../../http/errors.js";
import { open, seal } from "../secretBox.js";
import { createItopClient, type ItopClient } from "./client.js";
import { isValidTimeZone } from "./timezone.js";

// In-process cache for the ItopConfig singleton, mirroring authConfig.ts.
// The row is admin-edited and read on every sync tick and every /itop request;
// a 30s TTL avoids a per-request DB hit while keeping admin edits fast to
// propagate. Bust the cache from the admin PATCH route for instant effect.
const TTL_MS = 30_000;

interface CacheEntry {
  value: ItopConfig;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/** The singleton row, created on first read so callers never see "not found". */
export async function getItopConfig(): Promise<ItopConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  const row = await ensureRow();
  cache = { value: row, expiresAt: now + TTL_MS };
  return row;
}

// Two first-ever concurrent reads (scheduler boot + an admin GET) can race on
// the upsert's SELECT-then-INSERT and one loses with P2002; the loser re-reads.
async function ensureRow(): Promise<ItopConfig> {
  try {
    return await prisma.itopConfig.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.itopConfig.findUniqueOrThrow({ where: { id: "default" } });
    }
    throw err;
  }
}

export function bustItopConfigCache(): void {
  cache = null;
}

/** True when a base URL and an application token are both stored. */
export function isItopConfigured(config: Pick<ItopConfig, "baseUrl" | "appTokenEnc">): boolean {
  return Boolean(config.baseUrl && config.appTokenEnc);
}

/** Store the application token encrypted; `null` clears it. */
export function sealAppToken(plain: string | null): string | null {
  return plain === null ? null : seal(plain);
}

/**
 * The zone every date-parsing/formatting call site should actually use —
 * NEVER read `config.timezone` directly for that purpose. `PATCH
 * /admin/itop/settings` already validates a new value with
 * `isValidTimeZone` before writing it, so this should normally just be an
 * echo of the stored column, but a stored value can still go bad (the
 * column edited directly, a rare Node/ICU version dropping a zone name) —
 * an unattended sync tick must never abort over it. Falls back to `"UTC"`
 * and logs a warning rather than letting `zonedWallTimeToUtc`/
 * `utcToZonedWallTime` throw deep inside a sync run.
 */
export function resolveConfiguredTimezone(config: Pick<ItopConfig, "timezone">): string {
  if (isValidTimeZone(config.timezone)) return config.timezone;
  logger.warn(
    { timezone: config.timezone },
    "ItopConfig.timezone is not a recognized IANA timezone — falling back to UTC for this run",
  );
  return "UTC";
}

/**
 * A read-only client authenticated with the application token.
 * Throws 409 `itop_not_configured` when the admin has not connected iTop yet —
 * callers that want a soft answer check `isItopConfigured` first.
 */
export async function getItopAppClient(): Promise<ItopClient> {
  const config = await getItopConfig();
  if (!isItopConfigured(config)) {
    throw new HttpError(409, "itop_not_configured", "iTop is not connected. An admin must set the iTop URL and application token.");
  }
  return createItopClient({ baseUrl: config.baseUrl!, token: open(config.appTokenEnc!) });
}

/** A client for an arbitrary (already decrypted) token — used by Test connection and, later, per-TAM writes. */
export function makeItopClient(baseUrl: string, token: string): ItopClient {
  return createItopClient({ baseUrl, token });
}
