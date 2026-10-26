// Admin API for the iTop integration: connection settings, "Test connection"
// probes, org↔customer mapping, and the user↔iTop-person match report.
// Deliberately its own router (not folded into routes/admin.ts, a spine
// file) per docs/archive/plans/itop-integration.md §2 deviation 4 — mounted
// at /admin/itop in src/app.ts. Live iTop reads use the read-only app token
// (lib/itop/config.ts#getItopAppClient); nothing here writes to iTop.
import { Router } from "express";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { logger } from "../logger.js";
import { requireAuth, requireAdmin } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { open, seal, SecretBoxError } from "../lib/secretBox.js";
import { ITOP_TRANSPORT_ERROR_CODES, ItopError } from "../lib/itop/client.js";
import { assertPublicItopUrl } from "../lib/itop/validateBaseUrl.js";
import {
  getItopConfig,
  bustItopConfigCache,
  isItopConfigured,
  sealAppToken,
  getItopAppClient,
  makeItopClient,
} from "../lib/itop/config.js";
import { ITOP_ORGANIZATION_OUTPUT_FIELDS, type ItopOrganizationFields } from "../lib/itop/types.js";
import { ADVISORY_LOCK_KEY, syncTickets, syncUsers } from "../lib/itop/sync.js";
import { isValidTimeZone, utcToZonedWallTime, zonedWallTimeToUtc } from "../lib/itop/timezone.js";
// One-directional import (itop.ts never imports from this file) — busts
// Task 6.2's GET /services cache alongside every place here that busts the
// ItopConfig cache, so a base-URL/token change or a completed manual sync
// doesn't leave a stale service list cached for up to 5 more minutes.
import { bustItopServicesCache } from "./itop.js";

export const itopAdminRouter = Router();

itopAdminRouter.use(requireAuth, requireAdmin);

// ---- Shared helpers ---------------------------------------------------------

/**
 * Runs a live iTop call and maps `ItopError` to a 502 the frontend can show
 * verbatim. Transport-level failures (can't reach the host, timed out, bad
 * HTTP status, unparseable body) are distinguished from iTop's own
 * application-level error codes so the admin can tell "iTop is down" from
 * "iTop rejected the request" — either way iTop's own message string is
 * never rewritten. Also catches `SecretBoxError` from decrypting the stored
 * app token (e.g. `SECRETS_KEY` rotated since the token was saved) — every
 * caller here either decrypts a stored token directly or does so indirectly
 * via `getItopAppClient()`, so this is the one place that needs to know
 * about both failure modes.
 */
async function callItop<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SecretBoxError) {
      throw new HttpError(
        409,
        "itop_token_unreadable",
        "The stored iTop token could not be decrypted (SECRETS_KEY changed?) — enter it again.",
      );
    }
    if (err instanceof ItopError) {
      const code = ITOP_TRANSPORT_ERROR_CODES.has(err.code) ? "itop_unreachable" : "itop_error";
      throw new HttpError(502, code, err.message);
    }
    throw err;
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

interface CustomerOrgRow {
  id: number;
  name: string;
  itopOrgId: number | null;
  itopOrgName: string | null;
}

function toCustomerRow(customer: CustomerOrgRow) {
  return {
    id: customer.id,
    name: customer.name,
    itopOrgId: customer.itopOrgId,
    itopOrgName: customer.itopOrgName,
    match: matchKind(customer.name, customer.itopOrgName),
  };
}

function matchKind(customerName: string, orgName: string | null): "name" | "manual" | "unmatched" {
  if (orgName === null) return "unmatched";
  return normalizeName(customerName) === normalizeName(orgName) ? "name" : "manual";
}

async function listCustomerOrgRows() {
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, itopOrgId: true, itopOrgName: true },
  });
  return customers.map(toCustomerRow);
}

async function fetchLiveOrganizations(): Promise<Array<{ id: number; name: string }>> {
  // getItopAppClient() decrypts the stored token itself — wrap it in the same
  // callItop() as the actual request so a SecretBoxError there also maps to
  // 409 itop_token_unreadable instead of a raw 500.
  return callItop(async () => {
    const client = await getItopAppClient();
    const result = await client.getAll<ItopOrganizationFields>(
      "Organization",
      "SELECT Organization",
      ITOP_ORGANIZATION_OUTPUT_FIELDS,
    );
    return result.objects.map((row) => ({ id: row.key, name: row.fields.name }));
  });
}

interface PersonRow {
  id: number;
  username: string;
  email: string;
  itopPersonId: number | null;
  itopUserId: number | null;
  matched: boolean;
}

async function listPersonRows(): Promise<{ users: PersonRow[]; unmatched: number }> {
  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { username: "asc" },
    select: { id: true, username: true, email: true, itopPersonId: true, itopUserId: true },
  });
  const rows: PersonRow[] = users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    itopPersonId: u.itopPersonId,
    itopUserId: u.itopUserId,
    matched: u.itopPersonId !== null,
  }));
  return { users: rows, unmatched: rows.filter((r) => !r.matched).length };
}

// ---- Settings ---------------------------------------------------------------

async function loadConfigWithUpdater() {
  await getItopConfig(); // ensures the singleton row exists (upsert on first read)
  return prisma.itopConfig.findUniqueOrThrow({
    where: { id: "default" },
    include: { updatedBy: { select: { id: true, username: true } } },
  });
}

function serializeConfig(
  config: Awaited<ReturnType<typeof loadConfigWithUpdater>>,
) {
  return {
    baseUrl: config.baseUrl,
    appTokenSet: Boolean(config.appTokenEnc),
    webhookSecretSet: Boolean(config.webhookSecretEnc),
    timezone: config.timezone,
    refreshMinutes: config.refreshMinutes,
    readClasses: config.readClasses,
    capacityHoursPerWeek: config.capacityHoursPerWeek,
    actionsEnabled: config.actionsEnabled,
    lastSyncAt: config.lastSyncAt,
    lastSyncOk: config.lastSyncOk,
    lastSyncError: config.lastSyncError,
    lastFullSyncAt: config.lastFullSyncAt,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

itopAdminRouter.get("/settings", async (_req, res) => {
  const row = await loadConfigWithUpdater();
  res.json(serializeConfig(row));
});

const READ_CLASSES = ["UserRequest", "Incident"] as const;
const HTTPS_URL_PATTERN = /^https:\/\/\S+$/i;

// All fields optional — `undefined` (not sent) leaves the column alone;
// `null` clears baseUrl/appToken. Mirrors routes/admin.ts's
// updateAuthSettingsSchema shape (transform-then-refine) for the same reason:
// one PATCH can touch the URL, the token, or both.
const updateItopSettingsSchema = z.object({
  baseUrl: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      return v.trim().replace(/\/+$/, "");
    })
    .refine((v) => v === undefined || v === null || HTTPS_URL_PATTERN.test(v), {
      message: "baseUrl must be an https:// URL",
    }),
  appToken: z
    .union([z.string(), z.null()])
    .optional()
    .refine((v) => v === undefined || v === null || v.length >= 8, {
      message: "appToken must be at least 8 characters",
    }),
  // Just non-empty here — the actual IANA-name check (isValidTimeZone) runs
  // in the handler below so a bad zone name answers the distinct
  // `invalid_timezone` code rather than the generic `validation_error` a
  // Zod .refine() would produce.
  timezone: z.string().min(1).optional(),
  refreshMinutes: z.number().int().min(1).max(60).optional(),
  readClasses: z.array(z.enum(READ_CLASSES)).min(1).optional(),
  capacityHoursPerWeek: z.number().int().min(1).max(80).optional(),
  actionsEnabled: z.boolean().optional(),
});

/**
 * Re-derives what the correct UTC instant `stored` SHOULD have been, had it
 * originally been converted with `newTz` instead of `oldTz`: re-format the
 * stored instant back into the wall-clock digits iTop actually sent (under
 * the OLD zone), then reinterpret those SAME digits under the NEW zone.
 * DST-correct per row — the wall-clock parts, not a flat delta, are what
 * carry over, so two rows a few months apart can shift by different amounts
 * if a DST transition falls between them.
 */
function reconvertStoredDate(stored: Date, oldTz: string, newTz: string): Date {
  const wallClock = utcToZonedWallTime(stored, oldTz);
  const [datePart, timePart] = wallClock.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  return zonedWallTimeToUtc(year, month, day, hour, minute, second, newTz);
}

/**
 * Corrects every already-stored iTop-sourced timestamp that a forced full
 * re-sync would NOT otherwise fix, in place, when the admin changes
 * ItopConfig.timezone. A full ticket/time-entry sync (triggered by clearing
 * lastFullSyncAt, below) re-reads and re-converts everything it can still
 * SEE from iTop right now — but two things sit outside that reach:
 *
 * - `ItopTimeEntry` rows older than `TIME_ENTRY_WINDOW_MS` (8 weeks):
 *   `syncTimeEntries`'s own OQL fetch never asks iTop for anything older, so
 *   a stale conversion on a decade-old row would otherwise never be
 *   corrected. Every row's `startDate`/`endDate` (its only iTop-sourced
 *   DateTime columns — `syncedAt` is a Solvro-generated "when we synced
 *   this", never derived from an iTop wall-clock string, so it's excluded)
 *   is corrected here, not just the ones inside the sync window.
 * - `User.itopTokenExpiresAt`: set once when a TAM saves their personal
 *   token (routes/itopUser.ts) and never re-fetched on any schedule — no
 *   sync tick, full or not, ever touches it again.
 *
 * `ItopTicket` rows are deliberately NOT backfilled here: unlike
 * ItopTimeEntry, a full ticket pull has no time window at all (every ticket
 * for every mapped org, full stop), so the lastFullSyncAt-triggered full
 * sync this same PATCH already forces is sufficient on its own to
 * re-convert every ticket's dates under the new zone.
 */
async function backfillTimezoneConversion(
  tx: Prisma.TransactionClient,
  oldTz: string,
  newTz: string,
): Promise<{ timeEntriesUpdated: number; tokensUpdated: number }> {
  let timeEntriesUpdated = 0;
  const entries = await tx.itopTimeEntry.findMany({ select: { id: true, startDate: true, endDate: true } });
  for (const entry of entries) {
    const correctedStart = reconvertStoredDate(entry.startDate, oldTz, newTz);
    const correctedEnd = entry.endDate ? reconvertStoredDate(entry.endDate, oldTz, newTz) : null;
    if (
      correctedStart.getTime() !== entry.startDate.getTime() ||
      correctedEnd?.getTime() !== entry.endDate?.getTime()
    ) {
      await tx.itopTimeEntry.update({
        where: { id: entry.id },
        data: { startDate: correctedStart, endDate: correctedEnd },
      });
      timeEntriesUpdated += 1;
    }
  }

  let tokensUpdated = 0;
  const usersWithExpiry = await tx.user.findMany({
    where: { itopTokenExpiresAt: { not: null } },
    select: { id: true, itopTokenExpiresAt: true },
  });
  for (const user of usersWithExpiry) {
    if (!user.itopTokenExpiresAt) continue;
    const corrected = reconvertStoredDate(user.itopTokenExpiresAt, oldTz, newTz);
    if (corrected.getTime() !== user.itopTokenExpiresAt.getTime()) {
      await tx.user.update({ where: { id: user.id }, data: { itopTokenExpiresAt: corrected } });
      tokensUpdated += 1;
    }
  }

  return { timeEntriesUpdated, tokensUpdated };
}

itopAdminRouter.patch(
  "/settings",
  validate("body", updateItopSettingsSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof updateItopSettingsSchema>;

    if (body.timezone !== undefined && !isValidTimeZone(body.timezone)) {
      throw new HttpError(
        400,
        "invalid_timezone",
        `"${body.timezone}" is not a recognized IANA timezone name (e.g. "Europe/Paris", "UTC").`,
      );
    }

    const data: Prisma.ItopConfigUncheckedUpdateInput = { updatedById: req.user!.sub };

    // https without userinfo, and — when ITOP_ALLOW_PRIVATE_HOSTS=false — a
    // public host only (lib/itop/validateBaseUrl.ts).
    if (typeof body.baseUrl === "string") await assertPublicItopUrl(body.baseUrl);
    if (typeof body.appToken === "string") {
      // Prove the new token works before sealing it: a typo would otherwise
      // be stored and break every sync until someone notices. The probe goes
      // to the address that will be stored (the new one, else the current).
      const probeUrl = typeof body.baseUrl === "string" ? body.baseUrl : body.baseUrl === null ? undefined : (await getItopConfig()).baseUrl;
      if (probeUrl) {
        try {
          await makeItopClient(probeUrl, body.appToken).listOperations();
        } catch (err) {
          const refused =
            err instanceof ItopError && (typeof err.code === "number" || err.status === 401 || err.status === 403);
          if (refused) {
            throw new HttpError(400, "itop_token_rejected", "iTop refused this application token. Check it and try again.");
          }
          await callItop(async () => {
            throw err;
          });
        }
      }
    }
    if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl;
    if (body.appToken !== undefined) data.appTokenEnc = sealAppToken(body.appToken);
    if (body.refreshMinutes !== undefined) data.refreshMinutes = body.refreshMinutes;
    if (body.readClasses !== undefined) data.readClasses = body.readClasses;
    if (body.capacityHoursPerWeek !== undefined) data.capacityHoursPerWeek = body.capacityHoursPerWeek;
    if (body.actionsEnabled !== undefined) data.actionsEnabled = body.actionsEnabled;

    await getItopConfig(); // ensures the row exists before the transaction below

    let disconnectedUsers = 0;
    await prisma.$transaction(
      async (tx) => {
        // Read the CURRENT stored zone from inside this transaction, not
        // the 30s-cached getItopConfig() — a stale cache read here could
        // compare the new value against an already-superseded old one (or
        // vice versa), silently skipping the backfill/lastFullSyncAt clear
        // a real change needs, or running it for a no-op PATCH.
        const currentConfig = await tx.itopConfig.findUniqueOrThrow({ where: { id: "default" } });

        // A real address change disconnects every user's personal token in
        // the same transaction. The write routes (routes/itop.ts) decrypt a
        // user's token and send it in the Auth-Token header to whatever
        // baseUrl is stored, so tokens issued for the old iTop must never
        // reach a re-pointed one — whether an admin mistyped the address or
        // an admin session was stolen. Same rule as routes/outlineAdmin.ts
        // for the Outline address. (The normalised body value is compared;
        // a no-op PATCH with the same address keeps every token.)
        if (body.baseUrl !== undefined && body.baseUrl !== currentConfig.baseUrl) {
          const wiped = await tx.user.updateMany({
            where: { itopTokenEnc: { not: null } },
            data: {
              itopTokenEnc: null,
              itopTokenPersonName: null,
              itopTokenCheckedAt: null,
              itopTokenExpiresAt: null,
            },
          });
          disconnectedUsers = wiped.count;
        }

        if (body.timezone !== undefined) {
          data.timezone = body.timezone;
          if (body.timezone !== currentConfig.timezone) {
            // Every stored ticket/time-entry timestamp was converted using
            // the OLD zone — clearing lastFullSyncAt makes the next sync
            // tick a FULL one (shouldRunFull in lib/itop/sync.ts treats a
            // null lastFullSyncAt as "due"), which re-reads and
            // re-converts every currently-fetchable row under the NEW
            // zone. backfillTimezoneConversion (same transaction) then
            // corrects the two things that forced full sync can't reach —
            // see its own doc comment.
            data.lastFullSyncAt = null;
            await backfillTimezoneConversion(tx, currentConfig.timezone, body.timezone);
          }
          // body.timezone === currentConfig.timezone: assign it anyway
          // (harmless no-op write) but skip the backfill/clear entirely —
          // nothing actually changed.
        }

        await tx.itopConfig.update({ where: { id: "default" }, data });
      },
      { timeout: 60_000 }, // generous: a full backfill touches every itop_time_entry + linked user row
    );

    bustItopConfigCache();
    bustItopServicesCache();

    if (disconnectedUsers > 0) {
      logger.info(
        { disconnectedUsers },
        "iTop address changed: personal iTop tokens removed from all users",
      );
    }

    const row = await loadConfigWithUpdater();
    // `disconnectedUsers` tells the admin page how many people must connect
    // their iTop account again after an address change (0 otherwise).
    res.json({ ...serializeConfig(row), disconnectedUsers });
  },
);

// ---- Webhook secret -----------------------------------------------------------

// Generates a fresh secret for iTop's "on ticket update" trigger to send back
// as X-Solvro-Webhook-Secret (routes/webhook.ts, POST /webhook/itop — the
// admin-facing counterpart of Task 4.1). Shown once: the plaintext never
// round-trips through GET /settings, which only reports webhookSecretSet.
// See docs/archive/plans/itop-integration.md Task 4.1.
itopAdminRouter.post("/webhook-secret", async (req, res) => {
  const secret = crypto.randomBytes(32).toString("base64url");

  await getItopConfig(); // ensures the row exists before the update below
  await prisma.itopConfig.update({
    where: { id: "default" },
    data: { webhookSecretEnc: seal(secret), updatedById: req.user!.sub },
  });
  bustItopConfigCache();
  bustItopServicesCache();

  res.json({ secret, path: "/api/webhook/itop", header: "X-Solvro-Webhook-Secret" });
});

itopAdminRouter.delete("/webhook-secret", async (req, res) => {
  await getItopConfig();
  await prisma.itopConfig.update({
    where: { id: "default" },
    data: { webhookSecretEnc: null, updatedById: req.user!.sub },
  });
  bustItopConfigCache();
  bustItopServicesCache();

  res.status(204).end();
});

// ---- Test connection ---------------------------------------------------------

// baseUrl reuses HTTPS_URL_PATTERN (declared above with the settings schema)
// so a probe can't be aimed at an arbitrary http:// internal address just
// because it goes through /test instead of the persisted /settings.
const testConnectionSchema = z.object({
  baseUrl: z
    .string()
    .min(1)
    .optional()
    .transform((v) => (v === undefined ? undefined : v.trim().replace(/\/+$/, "")))
    .refine((v) => v === undefined || HTTPS_URL_PATTERN.test(v), {
      message: "baseUrl must be an https:// URL",
    }),
  appToken: z.string().min(1).optional(),
});

itopAdminRouter.post(
  "/test",
  validate("body", testConnectionSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof testConnectionSchema>;
    // The stored token must never be sent to an address the request names: a
    // probe of another address needs the token to try against it in the body.
    if (body.baseUrl !== undefined && body.appToken === undefined) {
      throw new HttpError(
        400,
        "app_token_required",
        "Provide the application token to test a different iTop address.",
      );
    }
    // Same host policy as PATCH /settings — a probe must not reach an
    // internal address just because it goes through /test.
    if (body.baseUrl !== undefined) await assertPublicItopUrl(body.baseUrl);
    const config = await getItopConfig();

    const baseUrl = body.baseUrl ?? config.baseUrl ?? undefined;
    const token =
      body.appToken ?? (config.appTokenEnc ? await callItop(async () => open(config.appTokenEnc!)) : undefined);

    if (!baseUrl || !token) {
      throw new HttpError(
        409,
        "itop_not_configured",
        "iTop is not connected. Provide a baseUrl and appToken, or configure them first.",
      );
    }

    const client = makeItopClient(baseUrl, token);
    const probes = await client.probe(); // never throws — unreachable/invalid still yields ok:false entries
    res.json({ ok: probes.every((p) => p.ok), probes });
  },
);

// ---- Sync trigger -------------------------------------------------------------

const syncBodySchema = z.object({ full: z.boolean().optional() });

// A full first sync of a real install can run well past nginx's proxy
// timeout (60s) if the request awaits it end to end — this module-level
// promise makes "Sync now" fire-and-forget: the route starts syncTickets()
// and returns immediately, tracking the in-flight run only to reject a
// second concurrent "Sync now" click with 202 {started:false} instead of
// queuing a redundant run (syncTickets()'s own Postgres advisory lock still
// guards against a second *process*, e.g. the scheduler, running at once —
// that case resolves silently in the background and is not surfaced here).
let syncInFlight: Promise<void> | null = null;

/**
 * Test-only hook: resolves once any fire-and-forget sync started by this
 * route has finished. Without this, a background sync left running past the
 * end of one test can still be mid-flight when the next test starts — racing
 * that test's own /sync calls (the "busy" guard) or its manipulation of the
 * shared ItopConfig singleton row. Not used by production code paths.
 */
export async function waitForItopSyncIdle(): Promise<void> {
  if (syncInFlight) {
    await syncInFlight;
  }
}

itopAdminRouter.post(
  "/sync",
  validate("body", syncBodySchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof syncBodySchema>;
    const config = await getItopConfig();
    if (!isItopConfigured(config)) {
      throw new HttpError(
        409,
        "itop_not_configured",
        "iTop is not connected. An admin must set the iTop URL and application token.",
      );
    }

    if (syncInFlight) {
      res.status(202).json({ started: false, reason: "busy" });
      return;
    }

    const full = body.full ?? true;
    const lastSyncAt = config.lastSyncAt;
    syncInFlight = (async () => {
      try {
        await syncTickets({ full });
        // A full sync can rename/relink orgs (Customer.itopOrgName), so the
        // cached service list's providerName values could be stale — bust
        // it here too, not just on a settings/token change.
        bustItopServicesCache();
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "iTop manual sync failed");
      } finally {
        syncInFlight = null;
      }
    })();

    res.status(202).json({ started: true, lastSyncAt });
  },
);

// ---- Organizations ------------------------------------------------------------

itopAdminRouter.get("/organizations", async (_req, res) => {
  const orgs = await fetchLiveOrganizations();
  const mappedCustomers = await prisma.customer.findMany({
    where: { itopOrgId: { not: null } },
    select: { id: true, itopOrgId: true },
  });
  const mappedByOrgId = new Map(mappedCustomers.map((c) => [c.itopOrgId as number, c.id]));

  const rows = orgs
    .map((org) => ({ id: org.id, name: org.name, mappedCustomerId: mappedByOrgId.get(org.id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(rows);
});

// ---- Customer ↔ org mapping -----------------------------------------------

itopAdminRouter.get("/customers", async (_req, res) => {
  res.json(await listCustomerOrgRows());
});

// Writes a customer's iTop mapping AND re-links the ticket snapshot in one
// transaction, so itop_tickets.customer_id never goes stale: tickets linked to
// this customer via a previous org are released, and tickets already in the
// snapshot for the newly mapped org are linked immediately (without waiting
// for the next sync tick to re-resolve them).
//
// The transaction's FIRST statements bound the wait (`lock_timeout`, local to
// this transaction) and take the sync's own advisory lock (`_xact`, released at
// COMMIT/ROLLBACK): a remap waits briefly for an in-flight sync instead of
// interleaving with it (a sync resolving tickets against the old org map would
// re-link rows the remap just moved), and a sync that starts while the remap
// holds the lock skips via its try-lock. A sync that outlasts the wait answers
// 409 `itop_sync_in_progress` — never a request hanging for the length of a
// sync — and nothing has changed.
let mappingLockTimeoutMs = 15_000;
/** Test hook: shortens (or restores) the wait for the sync lock. */
export function setMappingLockTimeoutMs(ms: number): void {
  mappingLockTimeoutMs = ms;
}

/** Postgres 55P03 lock_not_available, however Prisma surfaces it for a raw statement. */
function isLockNotAvailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as { code?: unknown; message?: unknown } | undefined;
    if (meta?.code === "55P03") return true;
  }
  const message = err instanceof Error ? err.message : "";
  return message.includes("55P03") || message.includes("lock timeout");
}

async function setCustomerOrgMapping(
  customerId: number,
  mapping: { itopOrgId: number; itopOrgName: string } | null,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${mappingLockTimeoutMs}ms`}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADVISORY_LOCK_KEY}))`;
        const updated = await tx.customer.update({
          where: { id: customerId },
          data: { itopOrgId: mapping?.itopOrgId ?? null, itopOrgName: mapping?.itopOrgName ?? null },
        });
        await tx.itopTicket.updateMany({
          where: {
            customerId,
            ...(mapping ? { orgId: { not: mapping.itopOrgId } } : {}),
          },
          data: { customerId: null },
        });
        if (mapping) {
          await tx.itopTicket.updateMany({
            where: { orgId: mapping.itopOrgId },
            data: { customerId },
          });
        }
        return updated;
      },
      { timeout: 30_000 },
    );
  } catch (err) {
    if (isLockNotAvailable(err)) {
      throw new HttpError(409, "itop_sync_in_progress", "An iTop sync is running. Try again in a minute.");
    }
    throw err;
  }
}

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const updateCustomerOrgSchema = z.object({ itopOrgId: z.number().int().positive().nullable() });

itopAdminRouter.patch(
  "/customers/:id",
  validate("params", idParamSchema),
  validate("body", updateCustomerOrgSchema),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof idParamSchema>;
    const { itopOrgId } = req.body as z.infer<typeof updateCustomerOrgSchema>;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new HttpError(404, "not_found", "Customer not found");

    if (itopOrgId === null) {
      const updated = await setCustomerOrgMapping(id, null);
      res.json(toCustomerRow(updated));
      return;
    }

    const orgs = await fetchLiveOrganizations();
    const org = orgs.find((o) => o.id === itopOrgId);
    if (!org) {
      throw new HttpError(400, "itop_org_not_found", `Organization ${itopOrgId} was not found in iTop`);
    }

    try {
      const updated = await setCustomerOrgMapping(id, { itopOrgId, itopOrgName: org.name });
      res.json(toCustomerRow(updated));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const holder = await prisma.customer.findUnique({
          where: { itopOrgId },
          select: { id: true, name: true },
        });
        throw new HttpError(
          409,
          "itop_org_already_mapped",
          `Organization ${itopOrgId} is already mapped to another customer`,
          holder ? { customerId: holder.id, customerName: holder.name } : undefined,
        );
      }
      throw err;
    }
  },
);

itopAdminRouter.post("/customers/automatch", async (_req, res) => {
  const orgs = await fetchLiveOrganizations();

  const mappedOrgIds = new Set(
    (
      await prisma.customer.findMany({ where: { itopOrgId: { not: null } }, select: { itopOrgId: true } })
    ).map((c) => c.itopOrgId as number),
  );

  const unmapped = await prisma.customer.findMany({
    where: { itopOrgId: null },
    orderBy: { name: "asc" },
  });

  let matched = 0;
  for (const customer of unmapped) {
    const candidates = orgs.filter(
      (org) => normalizeName(org.name) === normalizeName(customer.name) && !mappedOrgIds.has(org.id),
    );
    if (candidates.length === 1) {
      const org = candidates[0];
      try {
        await setCustomerOrgMapping(customer.id, { itopOrgId: org.id, itopOrgName: org.name });
        mappedOrgIds.add(org.id);
        matched += 1;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          // Raced with another mapping of the same org between our read and
          // this write (e.g. a concurrent PATCH or automatch call) — the
          // in-memory `mappedOrgIds` guard above already prevents this within
          // a single automatch run, so this only fires on a genuine race.
          // Best-effort bulk operation: skip this customer, don't fail the batch.
          mappedOrgIds.add(org.id);
          continue;
        }
        throw err;
      }
    }
  }

  res.json({ matched, customers: await listCustomerOrgRows() });
});

// ---- User ↔ iTop person match report ---------------------------------------

itopAdminRouter.get("/persons", async (_req, res) => {
  res.json(await listPersonRows());
});

itopAdminRouter.post("/persons/match", async (_req, res) => {
  await syncUsers();
  res.json(await listPersonRows());
});
