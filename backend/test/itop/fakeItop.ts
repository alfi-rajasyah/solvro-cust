// In-memory fake iTop server: a test double for backend vitest suites and
// for manual dev-stack checks via ./run-fake-itop.ts. It speaks just
// enough of the iTop REST/JSON v1.3 protocol (docs/archive/plans/
// itop-integration-spec.md "How it works") to exercise
// backend/src/lib/itop/client.ts. Not a product — kept small and readable.

import express, { type Express } from "express";
import type { Server } from "node:http";
import {
  ITOP_TIME_SPENT_TICKET_REF_FIELD,
  type ItopTicketClass,
} from "../../src/lib/itop/types.js";

// ---------------------------------------------------------------------------
// State

export interface FakeItopToken {
  valid: boolean;
  canWrite: boolean;
  personId?: number;
}

interface OrganizationRecord {
  id: number;
  name: string;
}

interface PersonRecord {
  id: number;
  email: string;
  friendlyname: string;
  /** Task 6.2: `GET /itop/customers/:id/contacts` filters Person by this against the customer's mapped org — 0 means "no organization" (never matches a real org id). */
  org_id: number;
}

/** Task 6.2's "New ticket" service picklist (`GET /itop/services`). */
interface ServiceRecord {
  id: number;
  name: string;
  org_id: number;
}

interface UserRecord {
  id: number;
  contactid: number;
  contactid_friendlyname: string;
  login: string;
}

/** A `lnkPersonToTeam` link row — Phase 5's `assign_to_me` resolves a person's team(s) through this class. */
interface LnkPersonToTeamRecord {
  id: number;
  person_id: number;
  team_id: number;
  team_id_friendlyname: string;
}

/** Minimal `PersonalToken` row for the best-effort expiry read in `PUT /itop/me/token`. */
interface PersonalTokenRecord {
  id: number;
  user_id: number;
  expiration_date: string;
}

export interface FakeItopCaseLogEntry {
  date: string;
  user_login: string;
  message: string;
}

export interface TicketRecord {
  id: number;
  class: ItopTicketClass;
  ref: string;
  title: string;
  status: string;
  operational_status: string;
  /** `"1".."4"` codes (1 critical .. 4 low) on a real install — never the words "medium"/"high". */
  priority: string;
  agent_id: string;
  agent_id_friendlyname: string;
  team_id_friendlyname: string;
  service_id_friendlyname: string;
  caller_id_friendlyname: string;
  org_id: string;
  start_date: string;
  last_update: string;
  /** JSON integer (elapsed SLA-stopwatch seconds) on a real install — a genuine `number`, not a numeric string, and NOT a deadline. Solvro's sync never reads this attribute (see `tto_escalation_deadline`) but the fake still returns it, matching the real shape. */
  tto: number;
  /** Same shape/caveat as `tto` above, for the TTR clock. */
  ttr: number;
  /** `"YYYY-MM-DD HH:MM:SS"` deadline, or `""` when the TTO clock isn't running — the field Solvro's sync actually reads into `ItopTicket.tto`. */
  tto_escalation_deadline: string;
  /** Same shape as `tto_escalation_deadline`, for TTR — read into `ItopTicket.ttr`. */
  ttr_escalation_deadline: string;
  sla_tto_passed: string;
  sla_ttr_passed: string;
  resolution_date: string;
  public_log: { entries: FakeItopCaseLogEntry[] };
  private_log: { entries: FakeItopCaseLogEntry[] };
}

interface TimeSpentRecord {
  id: number;
  user_id: string;
  org_id: string;
  start_date: string;
  end_date: string;
  duration: string;
  title: string;
  ticketRef: string;
}

export interface FakeItopState {
  tokens: Map<string, FakeItopToken>;
  organizations: Map<number, OrganizationRecord>;
  persons: Map<number, PersonRecord>;
  users: Map<number, UserRecord>;
  services: Map<number, ServiceRecord>;
  tickets: Map<number, TicketRecord>;
  timeSpent: Map<number, TimeSpentRecord>;
  lnkPersonToTeam: Map<number, LnkPersonToTeamRecord>;
  personalTokens: Map<number, PersonalTokenRecord>;
  /** Classes `core/get` refuses, to simulate a missing extension (e.g. Time Tracking). */
  disabledClasses: Set<string>;
  /** Every write attempt (core/create|update|apply_stimulus), in order — asserts a route never writes with the application token, and (via `comment`) that every write sends one, per a real iTop 3.2.2 install's refusal of core/update and core/apply_stimulus with no comment at all. Recorded regardless of outcome (including a refusal), keyed by the raw Auth-Token header value. `comment` is whatever the request sent, `undefined` when it sent none at all. */
  writeLog: Array<{ token: string; operation: string; comment?: string }>;
  /**
   * One-shot trap: the NEXT `core/get` made with exactly this token fails
   * with `message`, then clears itself. Lets a test simulate "the read-only
   * re-read after an already-successful write failed" (e.g. the app token
   * becoming briefly unreachable) without reaching into the app's config
   * mid-request — set this right before triggering the write.
   */
  failNextGetForToken: { token: string; message: string } | null;
  nextId: number;
  /** Every request that reached `rest.php`, regardless of operation/outcome — lets a test prove a route's in-process cache (Task 6.2's `GET /itop/services`, 5-minute TTL) didn't re-hit the fake on a second call. */
  requestCount: number;
}

export function createEmptyState(): FakeItopState {
  return {
    tokens: new Map(),
    organizations: new Map(),
    persons: new Map(),
    users: new Map(),
    services: new Map(),
    tickets: new Map(),
    timeSpent: new Map(),
    lnkPersonToTeam: new Map(),
    personalTokens: new Map(),
    disabledClasses: new Set(),
    failNextGetForToken: null,
    writeLog: [],
    nextId: 1,
    requestCount: 0,
  };
}

/**
 * Test-double credentials for the fake iTop. They are deliberately built from
 * plain words (no entropy) and never accepted by anything but this in-memory
 * fake, so secret scanners do not mistake them for real credentials. The app
 * token is read-only; the three personal tokens map to seeded persons.
 */
const fakeItopToken = (who: string) => `fake-itop-token-for-${who}-not-a-secret`;
export const FAKE_ITOP_TOKENS = {
  app: "app-token-readonly",
  rina: fakeItopToken("rina"),
  dedi: fakeItopToken("dedi"),
  imposter: fakeItopToken("imposter"),
} as const;

const SUPPORTED_CLASSES = [
  "Organization",
  "UserRequest",
  "Incident",
  "Person",
  "User",
  "Service",
  "TimeSpent",
  "lnkPersonToTeam",
  "PersonalToken",
];
const WRITE_OPERATIONS = new Set(["core/create", "core/update", "core/apply_stimulus"]);

// ---------------------------------------------------------------------------
// Seed data

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function daysAgo(days: number, hours = 9): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, 0, 0, 0);
  return formatDate(date);
}

/**
 * Populates 2 organizations, 4 persons (one with an email that matches no
 * Solvro user on purpose), 3 users (contactid -> person), ~12 tickets across
 * both classes and both orgs with mixed statuses, and ~14 TimeSpent rows
 * over the last 3 weeks — including current- and previous-week rows for 2
 * users, some with `org_id: 0` (no organization, exercising the "No
 * customer" Utilization row). Pass the result to `createFakeItop`.
 */
export function seedFakeItop(): FakeItopState {
  const state = createEmptyState();

  state.tokens.set(FAKE_ITOP_TOKENS.app, { valid: true, canWrite: false });
  state.tokens.set(FAKE_ITOP_TOKENS.rina, { valid: true, canWrite: true, personId: 1 });
  state.tokens.set(FAKE_ITOP_TOKENS.dedi, { valid: true, canWrite: true, personId: 2 });
  // A SECOND token that also nominally belongs to person 2 (Dedi) — used by
  // test/itop/itopToken.test.ts to prove that being able to read a Person
  // by email (which ignores which token asked) isn't enough to save a
  // token: the PersonalToken ownership check below only lets a token see
  // ITS OWN user's PersonalToken row, so pasting this token for a Solvro
  // account whose email resolves to a DIFFERENT person (Rina) still gets
  // refused.
  state.tokens.set(FAKE_ITOP_TOKENS.imposter, { valid: true, canWrite: true, personId: 2 });

  state.organizations.set(1, { id: 1, name: "Northwind Freight Sdn Bhd" });
  state.organizations.set(2, { id: 2, name: "PT Sinar Logistik" });

  state.persons.set(1, { id: 1, email: "rina.s@example.co.id", friendlyname: "Rina S.", org_id: 1 });
  state.persons.set(2, { id: 2, email: "dedi.p@example.co.id", friendlyname: "Dedi P.", org_id: 2 });
  // Budi is a caller in org 1 (matches mkTicket's hardcoded caller_id_friendlyname
  // below) — used by Task 6.2's contacts endpoint tests as a 2nd org-1 contact.
  state.persons.set(3, { id: 3, email: "budi.h@example.co.id", friendlyname: "Budi H.", org_id: 1 });
  // Deliberately unmatched: no Solvro user is expected to have this email.
  // org_id 0 ("no organization") so it never appears as a contact for org 1 or 2.
  state.persons.set(4, { id: 4, email: "orphan.contact@example.co.id", friendlyname: "Orphan Contact", org_id: 0 });

  // Task 6.2's "New ticket" service picklist — org_id is the providing
  // organization, surfaced as `providerName` by GET /itop/services.
  state.services.set(1, { id: 1, name: "Network / WAN", org_id: 1 });
  state.services.set(2, { id: 2, name: "Service Desk", org_id: 2 });
  state.services.set(3, { id: 3, name: "Backup", org_id: 1 });

  state.users.set(1, { id: 1, contactid: 1, contactid_friendlyname: "Rina S.", login: "rina.s" });
  state.users.set(2, { id: 2, contactid: 2, contactid_friendlyname: "Dedi P.", login: "dedi.p" });
  state.users.set(3, { id: 3, contactid: 3, contactid_friendlyname: "Budi H.", login: "budi.h" });

  // Rina belongs to exactly one team (assign_to_me resolves it automatically);
  // Dedi belongs to two (exercises the 409 itop_team_required "pick one" path).
  state.lnkPersonToTeam.set(1, { id: 1, person_id: 1, team_id: 10, team_id_friendlyname: "TAM Team" });
  state.lnkPersonToTeam.set(2, { id: 2, person_id: 2, team_id: 10, team_id_friendlyname: "TAM Team" });
  state.lnkPersonToTeam.set(3, { id: 3, person_id: 2, team_id: 11, team_id_friendlyname: "Escalation Team" });

  // Minimal PersonalToken rows, one per real personal-token holder — each
  // token can only see ITS OWN user's row here (see the ownership filter in
  // `collectionFor`'s "PersonalToken" case below), mirroring real iTop's
  // per-user scoping of this class.
  state.personalTokens.set(1, { id: 1, user_id: 1, expiration_date: daysAgo(-90) });
  state.personalTokens.set(2, { id: 2, user_id: 2, expiration_date: daysAgo(-60) });

  const ticketSeeds: Array<Omit<TicketRecord, "id">> = [
    mkTicket({ class: "Incident", ref: "R-004512", title: "Branch 5 VPN tunnel flapping", status: "assigned", agentId: 1, orgId: 1, ageDays: 2, ttrPassed: true }),
    mkTicket({ class: "UserRequest", ref: "R-004530", title: "Add 2 users to the Acronis console", status: "assigned", agentId: 1, orgId: 1, ageDays: 0 }),
    mkTicket({ class: "UserRequest", ref: "R-004498", title: "Monthly backup report not received", status: "pending", agentId: 2, orgId: 1, ageDays: 4 }),
    mkTicket({ class: "UserRequest", ref: "R-004535", title: "Firewall rule for the new HR app", status: "new", agentId: undefined, orgId: 1, ageDays: 0 }),
    mkTicket({ class: "Incident", ref: "R-004471", title: "Veeam job failing on VM-DB02", status: "resolved", agentId: 1, orgId: 1, ageDays: 3 }),
    mkTicket({ class: "UserRequest", ref: "R-004402", title: "Printer queue stuck, floor 3", status: "closed", agentId: 2, orgId: 1, ageDays: 10 }),
    mkTicket({ class: "UserRequest", ref: "R-004488", title: "VPN client licence renewal", status: "assigned", agentId: 3, orgId: 2, ageDays: 1 }),
    mkTicket({ class: "UserRequest", ref: "R-004519", title: "New starter laptop provisioning", status: "new", agentId: undefined, orgId: 2, ageDays: 0 }),
    mkTicket({ class: "Incident", ref: "R-004501", title: "Warehouse scanner offline", status: "pending", agentId: 3, orgId: 2, ageDays: 2 }),
    mkTicket({ class: "UserRequest", ref: "R-004540", title: "Mailbox quota increase", status: "resolved", agentId: 3, orgId: 2, ageDays: 5 }),
    mkTicket({ class: "Incident", ref: "R-004545", title: "Core switch reboot loop", status: "assigned", agentId: 1, orgId: 2, ageDays: 1, ttrPassed: true }),
    mkTicket({ class: "UserRequest", ref: "R-004550", title: "Guest wifi password rotation", status: "closed", agentId: 2, orgId: 2, ageDays: 14 }),
  ];
  for (const seed of ticketSeeds) {
    const id = state.nextId++;
    state.tickets.set(id, { id, ...seed });
  }

  const timeSpentSeeds: Array<{ userId: number; orgId: number; ref: string; daysAgo: number; minutes: number }> = [
    { userId: 1, orgId: 1, ref: "R-004512", daysAgo: 1, minutes: 90 },
    { userId: 1, orgId: 1, ref: "R-004530", daysAgo: 2, minutes: 45 },
    { userId: 1, orgId: 2, ref: "R-004545", daysAgo: 3, minutes: 60 },
    { userId: 2, orgId: 1, ref: "R-004498", daysAgo: 4, minutes: 30 },
    { userId: 2, orgId: 2, ref: "R-004550", daysAgo: 5, minutes: 120 },
    { userId: 3, orgId: 2, ref: "R-004488", daysAgo: 6, minutes: 75 },
    { userId: 1, orgId: 1, ref: "R-004512", daysAgo: 8, minutes: 50 },
    { userId: 2, orgId: 1, ref: "R-004402", daysAgo: 10, minutes: 40 },
    { userId: 3, orgId: 2, ref: "R-004501", daysAgo: 15, minutes: 100 },
    { userId: 1, orgId: 2, ref: "R-004545", daysAgo: 20, minutes: 65 },
    // Current-week rows for 2 users, one of them not tied to any
    // organization (org_id 0 — iTop's "unset" for an optional org link).
    // Phase 3.2's Utilization matrix groups these under "No customer".
    { userId: 1, orgId: 0, ref: "", daysAgo: 0, minutes: 45 },
    { userId: 2, orgId: 0, ref: "", daysAgo: 1, minutes: 30 },
    // Previous-week rows for the same 2 users, same mix of org / no-org.
    { userId: 1, orgId: 1, ref: "R-004530", daysAgo: 9, minutes: 55 },
    { userId: 2, orgId: 0, ref: "", daysAgo: 10, minutes: 25 },
  ];
  for (const seed of timeSpentSeeds) {
    const id = state.nextId++;
    const start = daysAgo(seed.daysAgo, 9);
    const startDate = new Date(start.replace(" ", "T"));
    const end = new Date(startDate.getTime() + seed.minutes * 60_000);
    state.timeSpent.set(id, {
      id,
      user_id: String(seed.userId),
      org_id: String(seed.orgId),
      start_date: start,
      end_date: formatDate(end),
      duration: String(seed.minutes * 60),
      title: seed.ref,
      ticketRef: seed.ref,
    });
  }

  return state;
}

function mkTicket(opts: {
  class: ItopTicketClass;
  ref: string;
  title: string;
  status: string;
  agentId: number | undefined;
  orgId: number;
  ageDays: number;
  ttrPassed?: boolean;
}): Omit<TicketRecord, "id"> {
  const agentNames: Record<number, string> = { 1: "Rina S.", 2: "Dedi P.", 3: "Budi H." };
  const resolvedOrClosed = opts.status === "resolved" || opts.status === "closed";
  return {
    class: opts.class,
    ref: opts.ref,
    title: opts.title,
    status: opts.status,
    operational_status: opts.status === "assigned" && opts.ttrPassed ? "escalated_ttr" : "normal",
    // "1".."4" codes (1 critical .. 4 low) — a real install's own shape;
    // stored as-is by Solvro, never translated to a word here.
    priority: opts.ttrPassed ? "2" : "3",
    agent_id: opts.agentId ? String(opts.agentId) : "0",
    agent_id_friendlyname: opts.agentId ? agentNames[opts.agentId] : "",
    team_id_friendlyname: "TAM Team",
    service_id_friendlyname: opts.class === "Incident" ? "Network / WAN" : "Service Desk",
    caller_id_friendlyname: "Budi H.",
    org_id: String(opts.orgId),
    start_date: daysAgo(opts.ageDays),
    last_update: daysAgo(Math.max(opts.ageDays - 1, 0)),
    // Elapsed SLA-stopwatch seconds — never read by Solvro's sync (kept only
    // so a `probe()`/protocol-shape test sees the same fields a real install
    // returns).
    tto: 3600,
    ttr: 10800,
    // Escalation deadlines — "" (clock not running) once resolved/closed,
    // otherwise a datetime a day or two out. These, not the integers above,
    // are what Solvro's sync maps into ItopTicket.tto/ttr.
    tto_escalation_deadline: resolvedOrClosed ? "" : daysAgo(-1),
    ttr_escalation_deadline: resolvedOrClosed ? "" : daysAgo(-2),
    sla_tto_passed: "0",
    sla_ttr_passed: opts.ttrPassed ? "1" : "0",
    resolution_date: resolvedOrClosed ? daysAgo(Math.max(opts.ageDays - 1, 0)) : "",
    public_log: { entries: [] },
    private_log: { entries: [] },
  };
}

// ---------------------------------------------------------------------------
// OQL — a small regex-based subset, per docs/archive/plans/itop-integration.md Task 1.3.

type OqlCondition =
  | { field: string; op: "="; value: string }
  | { field: string; op: "IN"; value: string[] }
  | { field: string; op: ">" | ">="; value: string };

function parseOql(oql: string): { className: string; conditions: OqlCondition[] } {
  const selectMatch = /^SELECT\s+(\w+)\s*(?:WHERE\s+(.+))?$/i.exec(oql.trim());
  if (!selectMatch) {
    throw new Error(`Invalid query: could not parse '${oql}'`);
  }
  const className = selectMatch[1];
  const whereClause = selectMatch[2];
  if (!whereClause) return { className, conditions: [] };

  const conditions: OqlCondition[] = whereClause.split(/\s+AND\s+/i).map((rawPart) => {
    const part = rawPart.trim();

    const inMatch = /^(\w+)\s+IN\s*\((.+)\)$/i.exec(part);
    if (inMatch) {
      const values = inMatch[2].split(",").map((v) => {
        const trimmed = v.trim();
        const quoted = /^'(.*)'$/.exec(trimmed);
        return quoted ? quoted[1] : trimmed;
      });
      return { field: inMatch[1], op: "IN", value: values };
    }

    const gteMatch = /^(\w+)\s*>=\s*'([^']*)'$/.exec(part);
    if (gteMatch) return { field: gteMatch[1], op: ">=", value: gteMatch[2] };

    const gtMatch = /^(\w+)\s*>\s*'([^']*)'$/.exec(part);
    if (gtMatch) return { field: gtMatch[1], op: ">", value: gtMatch[2] };

    const eqStrMatch = /^(\w+)\s*=\s*'([^']*)'$/.exec(part);
    if (eqStrMatch) return { field: eqStrMatch[1], op: "=", value: eqStrMatch[2] };

    const eqIntMatch = /^(\w+)\s*=\s*(\d+)$/.exec(part);
    if (eqIntMatch) return { field: eqIntMatch[1], op: "=", value: eqIntMatch[2] };

    throw new Error(`Invalid query: unsupported condition '${part}'`);
  });

  return { className, conditions };
}

function matchesConditions(fields: Record<string, unknown>, conditions: OqlCondition[]): boolean {
  return conditions.every((cond) => {
    const actual = fields[cond.field];
    if (typeof actual !== "string") return false;
    if (cond.op === "IN") return cond.value.includes(actual);
    if (cond.op === "=") return actual === cond.value;
    if (cond.op === ">") return actual > cond.value;
    return actual >= cond.value;
  });
}

// ---------------------------------------------------------------------------
// Field projection

function filterFields(fields: Record<string, unknown>, outputFields: string): Record<string, unknown> {
  const wanted = outputFields
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (wanted.length === 0 || wanted.includes("*")) return { ...fields };
  const result: Record<string, unknown> = {};
  for (const key of wanted) {
    if (key in fields) result[key] = fields[key];
  }
  return result;
}

function ticketFields(ticket: TicketRecord): Record<string, unknown> {
  const { id: _id, class: _class, ...rest } = ticket;
  return { id: String(ticket.id), ...rest };
}

function timeSpentFields(entry: TimeSpentRecord): Record<string, unknown> {
  return {
    id: String(entry.id),
    user_id: entry.user_id,
    org_id: entry.org_id,
    start_date: entry.start_date,
    end_date: entry.end_date,
    duration: entry.duration,
    title: entry.title,
    [ITOP_TIME_SPENT_TICKET_REF_FIELD]: entry.ticketRef,
  };
}

function organizationFields(org: OrganizationRecord): Record<string, unknown> {
  return { id: String(org.id), name: org.name };
}

function personFields(person: PersonRecord): Record<string, unknown> {
  return { id: String(person.id), email: person.email, friendlyname: person.friendlyname, org_id: String(person.org_id) };
}

function serviceFields(state: FakeItopState, service: ServiceRecord): Record<string, unknown> {
  const orgName = state.organizations.get(service.org_id)?.name ?? "";
  return { id: String(service.id), name: service.name, org_id: String(service.org_id), org_id_friendlyname: orgName };
}

function userFields(user: UserRecord): Record<string, unknown> {
  return {
    id: String(user.id),
    contactid: String(user.contactid),
    contactid_friendlyname: user.contactid_friendlyname,
    login: user.login,
  };
}

function lnkPersonToTeamFields(link: LnkPersonToTeamRecord): Record<string, unknown> {
  return {
    id: String(link.id),
    person_id: String(link.person_id),
    team_id: String(link.team_id),
    team_id_friendlyname: link.team_id_friendlyname,
  };
}

function personalTokenFields(pt: PersonalTokenRecord): Record<string, unknown> {
  return { id: String(pt.id), user_id: String(pt.user_id), expiration_date: pt.expiration_date };
}

/** The iTop `User.id` a token's own identity resolves to (via its `personId`'s `contactid` link), or `null` when it has none (e.g. the application token). */
function tokenOwnUserId(state: FakeItopState, requestingToken: FakeItopToken): number | null {
  if (requestingToken.personId === undefined) return null;
  const user = [...state.users.values()].find((u) => u.contactid === requestingToken.personId);
  return user ? user.id : null;
}

function collectionFor(
  state: FakeItopState,
  className: string,
  requestingToken: FakeItopToken,
): Array<{ id: number; fields: Record<string, unknown> }> {
  switch (className) {
    case "Organization":
      return [...state.organizations.values()].map((o) => ({ id: o.id, fields: organizationFields(o) }));
    case "Person":
      return [...state.persons.values()].map((p) => ({ id: p.id, fields: personFields(p) }));
    case "User":
      return [...state.users.values()].map((u) => ({ id: u.id, fields: userFields(u) }));
    case "Service":
      return [...state.services.values()].map((s) => ({ id: s.id, fields: serviceFields(state, s) }));
    case "UserRequest":
    case "Incident":
      return [...state.tickets.values()]
        .filter((t) => t.class === className)
        .map((t) => ({ id: t.id, fields: ticketFields(t) }));
    case "TimeSpent":
      return [...state.timeSpent.values()].map((e) => ({ id: e.id, fields: timeSpentFields(e) }));
    case "lnkPersonToTeam":
      return [...state.lnkPersonToTeam.values()].map((l) => ({ id: l.id, fields: lnkPersonToTeamFields(l) }));
    case "PersonalToken": {
      // Real iTop scopes a PersonalToken read to the querying token's OWN
      // user — a token can see its own row, never another user's. This is
      // what lets routes/itopUser.ts's ownership corroboration work: a
      // token that can read Person-by-email (which ignores identity) but
      // whose OWN PersonalToken scope excludes the resolved user's row
      // gets back zero rows, not someone else's token.
      const ownUserId = tokenOwnUserId(state, requestingToken);
      return [...state.personalTokens.values()]
        .filter((p) => ownUserId !== null && p.user_id === ownUserId)
        .map((p) => ({ id: p.id, fields: personalTokenFields(p) }));
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Ticket lifecycle (core/apply_stimulus)

// Confirmed against a real iTop 3.2.2 install (ITIL, default lifecycle):
// ev_assign is valid from "new" AND "pending" (both -> "assigned") with no
// mandatory fields (agent/team are optional there); it is REFUSED from
// "assigned" ("Invalid stimulus") — reassigning an already-assigned ticket
// is ev_reassign instead. ev_pending needs only pending_reason; ev_resolve
// needs only solution (resolution_code is optional on this install, even
// though Solvro's own action schema still requires both — see
// docs/archive/plans/itop-integration.md §"Ground truth" for the fix that
// prompted this).
const TICKET_STIMULI: Record<string, { from: string[]; to: string; required?: string[] }> = {
  ev_assign: { from: ["new", "pending"], to: "assigned" },
  ev_reassign: { from: ["assigned"], to: "assigned" },
  ev_pending: { from: ["assigned"], to: "pending", required: ["pending_reason"] },
  ev_resolve: { from: ["assigned", "pending"], to: "resolved", required: ["solution"] },
  ev_close: { from: ["resolved"], to: "closed" },
  ev_reopen: { from: ["resolved"], to: "assigned" },
};

/** Appends one case-log entry, authored by the writing token's person — mirrors iTop's own append (never replace) semantics for `public_log`/`private_log`. */
function appendCaseLogEntry(
  state: FakeItopState,
  ticket: TicketRecord,
  field: "public_log" | "private_log",
  token: FakeItopToken,
  message: string,
): void {
  const author = token.personId !== undefined ? (state.persons.get(token.personId)?.friendlyname ?? "") : "";
  ticket[field].entries.push({ date: formatDate(new Date()), user_login: author, message });
}

function applyTicketStimulus(
  state: FakeItopState,
  ticket: TicketRecord,
  stimulus: string,
  fields: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const rule = TICKET_STIMULI[stimulus];
  if (!rule) return { ok: false, message: `Invalid stimulus '${stimulus}'` };
  if (!rule.from.includes(ticket.status)) {
    return { ok: false, message: `Invalid stimulus '${stimulus}' for status '${ticket.status}'` };
  }
  const missingRequired = (rule.required ?? []).filter((required) => {
    const value = fields[required];
    return value === undefined || value === null || value === "";
  });
  if (missingRequired.length > 0) {
    // Exact wording confirmed against a real iTop 3.2.2 install (e.g. for
    // ev_pending with no pending_reason).
    return {
      ok: false,
      message: `Missing mandatory attribute(s) for applying the stimulus: ${missingRequired.join(", ")}.`,
    };
  }

  ticket.status = rule.to;
  if (stimulus === "ev_assign" || stimulus === "ev_reassign") {
    // Both agent_id and team_id are optional on this install (ground truth:
    // "it needs no mandatory fields") — only touch the ticket's agent/team
    // when the caller actually sent one, so an ev_assign with no fields at
    // all still transitions status without clobbering them to "0"/"".
    if (fields.agent_id !== undefined && fields.agent_id !== null && fields.agent_id !== "") {
      const agentId = Number(fields.agent_id);
      ticket.agent_id = String(agentId);
      ticket.agent_id_friendlyname = state.persons.get(agentId)?.friendlyname ?? String(fields.agent_id);
    }
    if (fields.team_id !== undefined && fields.team_id !== null && fields.team_id !== "") {
      ticket.team_id_friendlyname = String(fields.team_id);
    }
  }
  if (stimulus === "ev_resolve") {
    ticket.resolution_date = formatDate(new Date());
  }
  ticket.last_update = formatDate(new Date());
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Express app

interface FakeItopResult {
  app: Express;
  state: FakeItopState;
  listen(port?: number): Promise<{ server: Server; port: number; baseUrl: string }>;
}

function sendEnvelope(res: import("express").Response, body: Record<string, unknown>): void {
  res.json({ message: "", objects: null, ...body });
}

export function createFakeItop(seed: FakeItopState = createEmptyState()): FakeItopResult {
  const state = seed;
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.post("/webservices/rest.php", (req, res) => {
    state.requestCount += 1;
    let payload: Record<string, unknown>;
    try {
      const raw = req.body?.json_data ?? (typeof req.body === "object" ? JSON.stringify(req.body) : undefined);
      if (typeof raw !== "string") throw new Error("missing json_data");
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      res.status(400).json({ code: 100, message: "Invalid query: could not parse json_data" });
      return;
    }

    const authToken = req.header("Auth-Token");
    const token = authToken ? state.tokens.get(authToken) : undefined;
    if (!token || !token.valid) {
      sendEnvelope(res, { code: 1, message: "Error: Invalid login" });
      return;
    }

    const operation = payload.operation;
    const requestComment = typeof payload.comment === "string" ? payload.comment : undefined;

    if (typeof operation === "string" && WRITE_OPERATIONS.has(operation)) {
      // Recorded unconditionally — including a refusal further down — so a
      // test asserting "the application token is never used for a write" (or
      // "every write carries a comment") can check this regardless of
      // whether the write itself succeeded.
      state.writeLog.push({ token: authToken ?? "", operation, comment: requestComment });
    }

    // A real iTop 3.2.2 install refuses core/update and core/apply_stimulus
    // outright with no comment at all — `code 100 "Error: Missing parameter
    // 'comment'"`, verbatim. core/create does NOT require one on that
    // install, so it's deliberately excluded here. Checked after the
    // writeLog recording above (so a refused write is still visible there)
    // but before any class-specific handling, matching the real server
    // treating this as a generic REST-parameter check.
    if (
      (operation === "core/update" || operation === "core/apply_stimulus") &&
      (!requestComment || requestComment.trim().length === 0)
    ) {
      sendEnvelope(res, { code: 100, message: "Error: Missing parameter 'comment'" });
      return;
    }

    if (operation === "list_operations") {
      sendEnvelope(res, {
        code: 0,
        version: "1.3",
        operations: [
          { verb: "core/get", description: "Get objects", extension: "Core" },
          { verb: "core/create", description: "Create an object", extension: "Core" },
          { verb: "core/update", description: "Update an object", extension: "Core" },
          { verb: "core/apply_stimulus", description: "Apply a lifecycle stimulus", extension: "Core" },
          { verb: "list_operations", description: "List available operations", extension: "Core" },
        ],
      });
      return;
    }

    if (operation === "core/get") {
      if (state.failNextGetForToken && authToken === state.failNextGetForToken.token) {
        const { message } = state.failNextGetForToken;
        state.failNextGetForToken = null;
        sendEnvelope(res, { code: 100, message });
        return;
      }

      const className = String(payload.class);
      const outputFields = String(payload.output_fields ?? "*");
      const key = payload.key;

      if (!SUPPORTED_CLASSES.includes(className) || state.disabledClasses.has(className)) {
        sendEnvelope(res, { code: 100, message: `Invalid query: Unknown class '${className}'` });
        return;
      }

      const collection = collectionFor(state, className, token);
      let matched: Array<{ id: number; fields: Record<string, unknown> }>;
      if (typeof key === "number" || (typeof key === "string" && /^\d+$/.test(key))) {
        const id = Number(key);
        matched = collection.filter((entry) => entry.id === id);
      } else {
        try {
          const { conditions } = parseOql(String(key));
          matched = collection.filter((entry) => matchesConditions(entry.fields, conditions));
        } catch (err) {
          sendEnvelope(res, { code: 100, message: err instanceof Error ? err.message : String(err) });
          return;
        }
      }

      const limit = typeof payload.limit === "number" ? payload.limit : 0;
      const page = typeof payload.page === "number" && payload.page > 0 ? payload.page : 1;
      const paged = limit > 0 ? matched.slice((page - 1) * limit, (page - 1) * limit + limit) : matched;

      if (paged.length === 0) {
        sendEnvelope(res, { code: 0, objects: null });
        return;
      }
      const objects: Record<string, unknown> = {};
      for (const entry of paged) {
        objects[`${className}::${entry.id}`] = {
          code: 0,
          message: "",
          class: className,
          key: String(entry.id),
          fields: filterFields(entry.fields, outputFields),
        };
      }
      sendEnvelope(res, { code: 0, objects });
      return;
    }

    if (operation === "core/apply_stimulus") {
      const className = String(payload.class);
      const id = Number(payload.key);
      const stimulus = String(payload.stimulus);
      const fields = (payload.fields as Record<string, unknown> | undefined) ?? {};

      if (className !== "UserRequest" && className !== "Incident") {
        sendEnvelope(res, { code: 100, message: `Invalid query: Unknown class '${className}'` });
        return;
      }
      const ticket = state.tickets.get(id);
      if (!ticket) {
        sendEnvelope(res, { code: 100, message: `Object not found: ${className}::${id}` });
        return;
      }
      const result = applyTicketStimulus(state, ticket, stimulus, fields);
      if (!result.ok) {
        sendEnvelope(res, { code: 3, message: result.message });
        return;
      }
      sendEnvelope(res, {
        code: 0,
        objects: {
          [`${className}::${id}`]: {
            code: 0,
            message: "",
            class: className,
            key: String(id),
            fields: ticketFields(ticket),
          },
        },
      });
      return;
    }

    if (operation === "core/update") {
      const className = String(payload.class);
      const id = Number(payload.key);
      const fields = (payload.fields as Record<string, unknown> | undefined) ?? {};

      if (className === "UserRequest" || className === "Incident") {
        const ticket = state.tickets.get(id);
        if (!ticket) {
          sendEnvelope(res, { code: 100, message: `Object not found: ${className}::${id}` });
          return;
        }
        // public_log/private_log are case logs: iTop APPENDS a new entry
        // (stamped with the writing token's person and now), it never
        // replaces the whole log — every other field is a plain overwrite.
        const { public_log: publicLogText, private_log: privateLogText, ...rest } = fields;
        Object.assign(ticket, rest);
        if (typeof publicLogText === "string" && publicLogText.length > 0) {
          appendCaseLogEntry(state, ticket, "public_log", token, publicLogText);
        }
        if (typeof privateLogText === "string" && privateLogText.length > 0) {
          appendCaseLogEntry(state, ticket, "private_log", token, privateLogText);
        }
        ticket.last_update = formatDate(new Date());
        sendEnvelope(res, {
          code: 0,
          objects: {
            [`${className}::${id}`]: { code: 0, message: "", class: className, key: String(id), fields: ticketFields(ticket) },
          },
        });
        return;
      }

      sendEnvelope(res, { code: 100, message: `Unsupported class for core/update: '${className}'` });
      return;
    }

    if (operation === "core/create") {
      const className = String(payload.class);
      const fields = (payload.fields as Record<string, unknown> | undefined) ?? {};

      if (className === "UserRequest" || className === "Incident") {
        // Task 6.2 ("New ticket"): mirrors iTop's own mandatory-attribute
        // refusal (code 100) for a stimulus-free core/create of a ticket —
        // org_id, caller_id, title, description are all required, checked
        // in that order so a request missing several gets a deterministic
        // single message.
        const missing = (value: unknown) => value === undefined || value === null || value === "";
        const requiredFieldOrder: Array<[string, unknown]> = [
          ["org_id", fields.org_id],
          ["caller_id", fields.caller_id],
          ["title", fields.title],
          ["description", fields.description],
        ];
        const firstMissing = requiredFieldOrder.find(([, value]) => missing(value));
        if (firstMissing) {
          sendEnvelope(res, { code: 100, message: `Mandatory attribute '${firstMissing[0]}' is missing` });
          return;
        }

        const orgId = Number(fields.org_id);
        const callerId = Number(fields.caller_id);
        const callerPerson = state.persons.get(callerId);
        if (!callerPerson || callerPerson.org_id !== orgId) {
          sendEnvelope(res, {
            code: 100,
            message: `Data integrity issue: caller ${callerId} does not belong to organization ${orgId}`,
          });
          return;
        }

        // An unknown service_id is a real iTop-style external-key refusal
        // (unlike org_id/caller_id, this one is NOT re-validated by the
        // Solvro route before the create — it's the case a test uses to
        // exercise the "iTop's own refusal passes through verbatim" path).
        let serviceName = "";
        if (!missing(fields.service_id)) {
          const service = state.services.get(Number(fields.service_id));
          if (!service) {
            sendEnvelope(res, { code: 100, message: `Object not found: Service::${String(fields.service_id)}` });
            return;
          }
          serviceName = service.name;
        }

        const id = state.nextId++;
        const ref = `${className === "Incident" ? "I" : "R"}-${String(id).padStart(6, "0")}`;
        const ticket: TicketRecord = {
          id,
          class: className,
          ref,
          title: String(fields.title),
          status: "new",
          operational_status: "normal",
          priority: "3",
          agent_id: "0",
          agent_id_friendlyname: "",
          team_id_friendlyname: "",
          service_id_friendlyname: serviceName,
          caller_id_friendlyname: callerPerson.friendlyname,
          org_id: String(orgId),
          start_date: formatDate(new Date()),
          last_update: formatDate(new Date()),
          tto: 0,
          ttr: 0,
          tto_escalation_deadline: "",
          ttr_escalation_deadline: "",
          sla_tto_passed: "0",
          sla_ttr_passed: "0",
          resolution_date: "",
          public_log: { entries: [] },
          private_log: { entries: [] },
        };
        state.tickets.set(id, ticket);
        sendEnvelope(res, {
          code: 0,
          objects: {
            [`${className}::${id}`]: { code: 0, message: "", class: className, key: String(id), fields: ticketFields(ticket) },
          },
        });
        return;
      }

      if (className === "TimeSpent") {
        // Mirrors the UserRequest/Incident mandatory-attribute check above
        // (Task 7.1's POST /itop/tickets/:id/time always sends all five, but
        // the fake still refuses an incomplete create the same way real
        // iTop would, so a route regression here fails loudly instead of
        // silently defaulting).
        const missing = (value: unknown) => value === undefined || value === null || value === "";
        const requiredFieldOrder: Array<[string, unknown]> = [
          ["user_id", fields.user_id],
          ["org_id", fields.org_id],
          ["start_date", fields.start_date],
          ["end_date", fields.end_date],
          ["duration", fields.duration],
        ];
        const firstMissing = requiredFieldOrder.find(([, value]) => missing(value));
        if (firstMissing) {
          sendEnvelope(res, { code: 100, message: `Mandatory attribute '${firstMissing[0]}' is missing` });
          return;
        }

        // Lexicographic comparison is safe here — both are the fixed-width
        // "YYYY-MM-DD HH:MM:SS" shape lib/itop/sync.ts#formatItopDate emits.
        if (String(fields.end_date) <= String(fields.start_date)) {
          sendEnvelope(res, { code: 100, message: "end_date must be after start_date" });
          return;
        }

        // A Solvro-side stand-in for iTop's external-key resolution on
        // `ticket_ref` (assumed to point back to the UserRequest/Incident it
        // was logged against), pending the admin's confirmation that
        // `TimeSpent.<ref field>` is actually a writable external key on the
        // real install (plan §5 risk "Time Tracking schema differs") — same
        // shape as the unknown-`service_id` check on ticket create above in
        // the meantime. Solvro's own POST /itop/tickets/:id/time always
        // sends the ref of a ticket it just loaded from its own snapshot, so
        // this only fires when a test deliberately makes the fake and the
        // snapshot disagree (see ticketTime.test.ts's "iTop refusal" case) —
        // not reachable in normal operation.
        const ticketRef = fields[ITOP_TIME_SPENT_TICKET_REF_FIELD];
        if (!missing(ticketRef) && ![...state.tickets.values()].some((t) => t.ref === ticketRef)) {
          sendEnvelope(res, { code: 100, message: `Object not found: ${String(ticketRef)}` });
          return;
        }

        const id = state.nextId++;
        const entry: TimeSpentRecord = {
          id,
          user_id: String(fields.user_id),
          org_id: String(fields.org_id),
          start_date: String(fields.start_date),
          end_date: String(fields.end_date),
          duration: String(fields.duration),
          title: String(fields.title ?? ""),
          // NOT falling back to `title` — the ref field must come from
          // whatever the caller actually sent, so a route that forgets to
          // set it produces a genuinely empty ref rather than a
          // misleadingly-populated one that happens to equal the title.
          ticketRef: String(fields[ITOP_TIME_SPENT_TICKET_REF_FIELD] ?? ""),
        };
        state.timeSpent.set(id, entry);
        sendEnvelope(res, {
          code: 0,
          objects: {
            [`${className}::${id}`]: { code: 0, message: "", class: className, key: String(id), fields: timeSpentFields(entry) },
          },
        });
        return;
      }

      sendEnvelope(res, { code: 100, message: `Unsupported class for core/create: '${className}'` });
      return;
    }

    sendEnvelope(res, { code: 100, message: `Unsupported operation: '${String(operation)}'` });
  });

  function listen(port = 0): Promise<{ server: Server; port: number; baseUrl: string }> {
    return new Promise((resolve) => {
      const server = app.listen(port, () => {
        const address = server.address();
        const boundPort = typeof address === "object" && address !== null ? address.port : port;
        resolve({ server, port: boundPort, baseUrl: `http://127.0.0.1:${boundPort}` });
      });
    });
  }

  return { app, state, listen };
}
