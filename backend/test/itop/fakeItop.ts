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
}

interface UserRecord {
  id: number;
  contactid: number;
  contactid_friendlyname: string;
  login: string;
}

export interface TicketRecord {
  id: number;
  class: ItopTicketClass;
  ref: string;
  title: string;
  status: string;
  operational_status: string;
  priority: string;
  agent_id: string;
  agent_id_friendlyname: string;
  team_id_friendlyname: string;
  service_id_friendlyname: string;
  caller_id_friendlyname: string;
  org_id: string;
  start_date: string;
  last_update: string;
  tto: string;
  ttr: string;
  sla_tto_passed: string;
  sla_ttr_passed: string;
  resolution_date: string;
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
  tickets: Map<number, TicketRecord>;
  timeSpent: Map<number, TimeSpentRecord>;
  /** Classes `core/get` refuses, to simulate a missing extension (e.g. Time Tracking). */
  disabledClasses: Set<string>;
  nextId: number;
}

export function createEmptyState(): FakeItopState {
  return {
    tokens: new Map(),
    organizations: new Map(),
    persons: new Map(),
    users: new Map(),
    tickets: new Map(),
    timeSpent: new Map(),
    disabledClasses: new Set(),
    nextId: 1,
  };
}

const SUPPORTED_CLASSES = ["Organization", "UserRequest", "Incident", "Person", "User", "TimeSpent"];

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

  state.tokens.set("app-token-readonly", { valid: true, canWrite: false });
  state.tokens.set("tam-token-rina", { valid: true, canWrite: true, personId: 1 });
  state.tokens.set("tam-token-dedi", { valid: true, canWrite: true, personId: 2 });

  state.organizations.set(1, { id: 1, name: "Northwind Freight Sdn Bhd" });
  state.organizations.set(2, { id: 2, name: "PT Sinar Logistik" });

  state.persons.set(1, { id: 1, email: "rina.s@example.co.id", friendlyname: "Rina S." });
  state.persons.set(2, { id: 2, email: "dedi.p@example.co.id", friendlyname: "Dedi P." });
  state.persons.set(3, { id: 3, email: "budi.h@example.co.id", friendlyname: "Budi H." });
  // Deliberately unmatched: no Solvro user is expected to have this email.
  state.persons.set(4, { id: 4, email: "orphan.contact@example.co.id", friendlyname: "Orphan Contact" });

  state.users.set(1, { id: 1, contactid: 1, contactid_friendlyname: "Rina S.", login: "rina.s" });
  state.users.set(2, { id: 2, contactid: 2, contactid_friendlyname: "Dedi P.", login: "dedi.p" });
  state.users.set(3, { id: 3, contactid: 3, contactid_friendlyname: "Budi H.", login: "budi.h" });

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
  return {
    class: opts.class,
    ref: opts.ref,
    title: opts.title,
    status: opts.status,
    operational_status: opts.status === "assigned" && opts.ttrPassed ? "escalated_ttr" : "normal",
    priority: opts.ttrPassed ? "high" : "medium",
    agent_id: opts.agentId ? String(opts.agentId) : "0",
    agent_id_friendlyname: opts.agentId ? agentNames[opts.agentId] : "",
    team_id_friendlyname: "TAM Team",
    service_id_friendlyname: opts.class === "Incident" ? "Network / WAN" : "Service Desk",
    caller_id_friendlyname: "Budi H.",
    org_id: String(opts.orgId),
    start_date: daysAgo(opts.ageDays),
    last_update: daysAgo(Math.max(opts.ageDays - 1, 0)),
    tto: "3600",
    ttr: "10800",
    sla_tto_passed: "0",
    sla_ttr_passed: opts.ttrPassed ? "1" : "0",
    resolution_date: opts.status === "resolved" || opts.status === "closed" ? daysAgo(Math.max(opts.ageDays - 1, 0)) : "",
  };
}

// ---------------------------------------------------------------------------
// OQL — a small regex-based subset, per docs/plans/itop-integration.md Task 1.3.

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

function matchesConditions(fields: Record<string, string>, conditions: OqlCondition[]): boolean {
  return conditions.every((cond) => {
    const actual = fields[cond.field];
    if (actual === undefined) return false;
    if (cond.op === "IN") return cond.value.includes(actual);
    if (cond.op === "=") return actual === cond.value;
    if (cond.op === ">") return actual > cond.value;
    return actual >= cond.value;
  });
}

// ---------------------------------------------------------------------------
// Field projection

function filterFields(fields: Record<string, string>, outputFields: string): Record<string, string> {
  const wanted = outputFields
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (wanted.length === 0 || wanted.includes("*")) return { ...fields };
  const result: Record<string, string> = {};
  for (const key of wanted) {
    if (key in fields) result[key] = fields[key];
  }
  return result;
}

function ticketFields(ticket: TicketRecord): Record<string, string> {
  const { id: _id, class: _class, ...rest } = ticket;
  return { id: String(ticket.id), ...rest };
}

function timeSpentFields(entry: TimeSpentRecord): Record<string, string> {
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

function organizationFields(org: OrganizationRecord): Record<string, string> {
  return { id: String(org.id), name: org.name };
}

function personFields(person: PersonRecord): Record<string, string> {
  return { id: String(person.id), email: person.email, friendlyname: person.friendlyname };
}

function userFields(user: UserRecord): Record<string, string> {
  return {
    id: String(user.id),
    contactid: String(user.contactid),
    contactid_friendlyname: user.contactid_friendlyname,
    login: user.login,
  };
}

function collectionFor(state: FakeItopState, className: string): Array<{ id: number; fields: Record<string, string> }> {
  switch (className) {
    case "Organization":
      return [...state.organizations.values()].map((o) => ({ id: o.id, fields: organizationFields(o) }));
    case "Person":
      return [...state.persons.values()].map((p) => ({ id: p.id, fields: personFields(p) }));
    case "User":
      return [...state.users.values()].map((u) => ({ id: u.id, fields: userFields(u) }));
    case "UserRequest":
    case "Incident":
      return [...state.tickets.values()]
        .filter((t) => t.class === className)
        .map((t) => ({ id: t.id, fields: ticketFields(t) }));
    case "TimeSpent":
      return [...state.timeSpent.values()].map((e) => ({ id: e.id, fields: timeSpentFields(e) }));
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Ticket lifecycle (core/apply_stimulus)

const TICKET_STIMULI: Record<string, { from: string[]; to: string; required?: string[] }> = {
  ev_assign: { from: ["new"], to: "assigned", required: ["team_id", "agent_id"] },
  ev_pending: { from: ["assigned"], to: "pending" },
  ev_resolve: { from: ["assigned", "pending"], to: "resolved", required: ["resolution_code", "solution"] },
  ev_close: { from: ["resolved"], to: "closed" },
  ev_reopen: { from: ["resolved"], to: "assigned" },
};

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
  for (const required of rule.required ?? []) {
    const value = fields[required];
    if (value === undefined || value === null || value === "") {
      return { ok: false, message: `Missing mandatory field '${required}' for stimulus '${stimulus}'` };
    }
  }

  ticket.status = rule.to;
  if (stimulus === "ev_assign") {
    const agentId = Number(fields.agent_id);
    ticket.agent_id = String(agentId);
    ticket.agent_id_friendlyname = state.persons.get(agentId)?.friendlyname ?? String(fields.agent_id);
    ticket.team_id_friendlyname = String(fields.team_id);
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
      const className = String(payload.class);
      const outputFields = String(payload.output_fields ?? "*");
      const key = payload.key;

      if (!SUPPORTED_CLASSES.includes(className) || state.disabledClasses.has(className)) {
        sendEnvelope(res, { code: 100, message: `Invalid query: Unknown class '${className}'` });
        return;
      }

      const collection = collectionFor(state, className);
      let matched: Array<{ id: number; fields: Record<string, string> }>;
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
        Object.assign(ticket, fields);
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
        const id = state.nextId++;
        const ticket: TicketRecord = {
          id,
          class: className,
          ref: String(fields.ref ?? `NEW-${id}`),
          title: String(fields.title ?? ""),
          status: "new",
          operational_status: "normal",
          priority: String(fields.priority ?? "medium"),
          agent_id: "0",
          agent_id_friendlyname: "",
          team_id_friendlyname: "",
          service_id_friendlyname: String(fields.service_id_friendlyname ?? ""),
          caller_id_friendlyname: String(fields.caller_id_friendlyname ?? ""),
          org_id: String(fields.org_id ?? ""),
          start_date: formatDate(new Date()),
          last_update: formatDate(new Date()),
          tto: "",
          ttr: "",
          sla_tto_passed: "0",
          sla_ttr_passed: "0",
          resolution_date: "",
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
        const id = state.nextId++;
        const entry: TimeSpentRecord = {
          id,
          user_id: String(fields.user_id ?? ""),
          org_id: String(fields.org_id ?? ""),
          start_date: String(fields.start_date ?? formatDate(new Date())),
          end_date: String(fields.end_date ?? formatDate(new Date())),
          duration: String(fields.duration ?? "0"),
          title: String(fields.title ?? ""),
          ticketRef: String(fields[ITOP_TIME_SPENT_TICKET_REF_FIELD] ?? fields.title ?? ""),
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
