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
 *
 * `tto_escalation_deadline`/`ttr_escalation_deadline` (not the bare
 * `tto`/`ttr` attribute codes) — confirmed against a real iTop 3.2.2
 * install: `tto`/`ttr` are JSON *integers*, the elapsed seconds of the SLA
 * stopwatch, not a deadline; the escalation-deadline attributes are the
 * datetime (or empty, when the clock isn't running) fields
 * `ItopTicket.tto`/`ttr` actually need. See `docs/archive/plans/
 * itop-integration.md` §2 deviation notes and `lib/itop/sync.ts#upsertTicket`.
 */
export const ITOP_TICKET_OUTPUT_FIELDS =
  "ref,title,status,operational_status,priority,agent_id,agent_id_friendlyname," +
  "team_id_friendlyname,service_id_friendlyname,caller_id_friendlyname,org_id," +
  "start_date,last_update,tto_escalation_deadline,ttr_escalation_deadline," +
  "sla_tto_passed,sla_ttr_passed,resolution_date,public_log,private_log";

/** Row shape for `output_fields: ITOP_TICKET_OUTPUT_FIELDS` on a ticket class. */
export interface ItopTicketFields {
  ref: string;
  title: string;
  status: string;
  operational_status: string;
  /** `"1".."4"` priority codes (1 critical .. 4 low) on a real install — stored as-is; the frontend maps the code to a label. */
  priority: string;
  agent_id: string;
  agent_id_friendlyname: string;
  team_id_friendlyname: string;
  service_id_friendlyname: string;
  caller_id_friendlyname: string;
  org_id: string;
  start_date: string;
  last_update: string;
  /** `"YYYY-MM-DD HH:MM:SS"` deadline, or `""`/`null` when the TTO clock isn't running — never the bare `tto` integer-seconds attribute. */
  tto_escalation_deadline: string | null;
  /** `"YYYY-MM-DD HH:MM:SS"` deadline, or `""`/`null` when the TTR clock isn't running — never the bare `ttr` integer-seconds attribute. */
  ttr_escalation_deadline: string | null;
  sla_tto_passed: string;
  sla_ttr_passed: string;
  resolution_date: string;
  public_log?: ItopCaseLogRaw;
  private_log?: ItopCaseLogRaw;
}

/**
 * iTop's case-log ("public_log"/"private_log") attribute shape. Newer
 * versions answer `{ entries: [...] }`; older versions may answer a plain
 * (HTML/text) string with no structured entries — `sync.ts#normalizeCaseLog`
 * handles both, collapsing a bare string into one entry with no author.
 */
export interface ItopCaseLogRawEntry {
  date?: string;
  user_login?: string;
  user_id?: string;
  message?: string;
  message_html?: string;
  format?: "text" | "html";
}

export type ItopCaseLogRaw = string | { entries?: ItopCaseLogRawEntry[] } | null | undefined;

/** Normalised shape `ItopTicket.publicLog`/`privateLog` are stored as. */
export interface ItopCaseLogEntry {
  date: string | null;
  author: string | null;
  message: string;
}

/**
 * `lnkPersonToTeam` fields used to resolve which team(s) a person belongs to
 * for `assign_to_me`'s `ev_assign` stimulus (`team_id` is mandatory on that
 * install's DEFAULT lifecycle per plan §1 decision 9). Read with the acting
 * TAM's own token, never the application token.
 */
export const ITOP_LNK_PERSON_TO_TEAM_OUTPUT_FIELDS = "team_id,team_id_friendlyname";

export interface ItopLnkPersonToTeamFields {
  team_id: string;
  team_id_friendlyname: string;
}

/**
 * `PersonalToken` fields for the best-effort expiry read in
 * `routes/itopUser.ts` (`PUT /itop/me/token`). Real installs may refuse this
 * class to a non-admin token — callers treat any failure here as "expiry
 * unknown", never as a reason to reject the token itself.
 */
export const ITOP_PERSONAL_TOKEN_OUTPUT_FIELDS = "expiration_date";

export interface ItopPersonalTokenFields {
  expiration_date: string;
}

/**
 * `Service` fields for the "New ticket" picklist (Task 6.2, `GET
 * /itop/services`) — read with the APPLICATION client since it's a read, not
 * scoped to any one customer (a service is offered org-wide, not per
 * caller). `org_id_friendlyname` becomes the response's `providerName`.
 */
export const ITOP_SERVICE_OUTPUT_FIELDS = "name,org_id,org_id_friendlyname";

export interface ItopServiceFields {
  name: string;
  org_id: string;
  org_id_friendlyname: string;
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
