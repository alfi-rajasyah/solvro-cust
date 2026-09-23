// iTop REST/JSON (version 1.3) field shapes used by this project.
// Source: docs/archive/plans/itop-integration.md §3, §6 and
// docs/archive/plans/itop-integration-spec.md "How it works" — a snapshot of
// the fields Solvro reads, not the full iTop datamodel. Pure types only: no
// Prisma, no env.

/** Ticket classes Solvro reads (decision #7 — Changes/Work Orders excluded). */
export type ItopTicketClass = "UserRequest" | "Incident";

export const ITOP_TICKET_CLASSES: readonly ItopTicketClass[] = [
  "UserRequest",
  "Incident",
];

/**
 * `output_fields` for a ticket `core/get`/`core/get` OQL pull. Kept as one
 * constant so every call site (sync, probe, ad hoc scripts) asks for the
 * same shape; Phase 5 appends `public_log`/`private_log` separately since
 * those are read-only-app-token-safe but heavier and not needed by Phase 1.
 */
export const ITOP_TICKET_OUTPUT_FIELDS =
  "ref,title,status,operational_status,priority,agent_id,agent_id_friendlyname," +
  "team_id_friendlyname,service_id_friendlyname,caller_id_friendlyname,org_id," +
  "start_date,last_update,tto,ttr,sla_tto_passed,sla_ttr_passed,resolution_date";

/** Row shape for `output_fields: ITOP_TICKET_OUTPUT_FIELDS` on a ticket class. */
export interface ItopTicketFields {
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

export const ITOP_ORGANIZATION_OUTPUT_FIELDS = "id,name";

export interface ItopOrganizationFields {
  id: string;
  name: string;
}

export const ITOP_PERSON_OUTPUT_FIELDS = "id,email,friendlyname";

export interface ItopPersonFields {
  id: string;
  email: string;
  friendlyname: string;
}

/**
 * iTop `User` fields for resolving a Solvro `User` to the iTop actor on
 * `TimeSpent` rows. `contactid` points at the linked `Person`, whose email
 * is what Solvro actually matches on (see plan §3 join rules); `login` is
 * kept for the Admin match report, not for joining.
 */
export const ITOP_USER_OUTPUT_FIELDS = "id,contactid,contactid_friendlyname,login";

export interface ItopUserFields {
  id: string;
  contactid: string;
  contactid_friendlyname: string;
  login: string;
}

/**
 * `TimeSpent` (Time Tracking extension) fields Solvro reads (Phase 3).
 * `ITOP_TIME_SPENT_TICKET_REF_FIELD` names the field that links a TimeSpent
 * row back to its ticket — the exact attribute code depends on the real
 * install's Time Tracking extension version, so this is a single named
 * constant Phase 3 can repoint after probing the real install with
 * `output_fields: "*"` (plan §5 risk: "Time Tracking schema differs").
 */
export const ITOP_TIME_SPENT_TICKET_REF_FIELD = "ticket_ref" as const;

export const ITOP_TIME_SPENT_OUTPUT_FIELDS =
  `user_id,org_id,start_date,end_date,duration,title,${ITOP_TIME_SPENT_TICKET_REF_FIELD}`;

/**
 * Whether `TimeSpent.duration` is expressed in seconds (iTop core's own
 * default unit for a duration attribute) rather than minutes. Task 3.1
 * (`lib/itop/sync.ts`'s `syncTimeEntries`) assumes seconds and divides by 60
 * when converting to `ItopTimeEntry.durationMinutes`. If the real install's
 * Time Tracking extension reports `duration` in minutes instead, flip this
 * one constant — `probe()`'s `TimeSpent` field dump (see client.ts) is the
 * place to check before Phase 3 goes live against production iTop.
 */
export const ITOP_TIME_SPENT_DURATION_IN_SECONDS = true;

export interface ItopTimeSpentFields {
  user_id: string;
  org_id: string;
  start_date: string;
  end_date: string;
  duration: string;
  title: string;
  [ITOP_TIME_SPENT_TICKET_REF_FIELD]: string;
}
