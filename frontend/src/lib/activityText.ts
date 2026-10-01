// Turns one project activity event into a plain sentence
// (docs/archive/plans/collaboration-and-sharing.md, C5a). Pure and total: the
// `changes` payload is server JSON, so every read is defensive and an unknown
// shape degrades to a generic sentence instead of throwing.
//
// The log never holds note/comment bodies or description text, and this file
// never invents any: a description change reads "updated the description of X".
import { fmtDay } from "@/lib/formatDate";
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  RISK_CATEGORY_LABEL,
  RISK_STATUS_LABEL,
  TASK_STATUS_LABEL,
} from "@/lib/labels";
import type { ActivityEvent } from "@/lib/queries";

/** `actor` and `entity` render emphasised; `text` is plain. */
export interface ActivityPart {
  kind: "actor" | "text" | "entity";
  text: string;
}

export interface ActivitySentence {
  parts: ActivityPart[];
  /** The whole sentence as plain text (for tests, titles and screen readers). */
  text: string;
  /** Task the event is about, when it names one and the task was not deleted. */
  taskId: number | null;
}

type Changes = Record<string, unknown>;
type Parts = ActivityPart[];

const txt = (text: string): ActivityPart => ({ kind: "text", text });
const ent = (text: string): ActivityPart => ({ kind: "entity", text });

const MAX_VALUE_LENGTH = 60;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(s: string): string {
  return s.length > MAX_VALUE_LENGTH ? `${s.slice(0, MAX_VALUE_LENGTH - 1)}…` : s;
}

function lookup(table: Record<string, string>, v: string): string {
  return Object.prototype.hasOwnProperty.call(table, v) ? table[v] : v;
}

/** "dueDate" -> "due date", "isCriticalPath" -> "critical path". */
function humanizeField(field: string): string {
  const words = field
    .replace(/^is(?=[A-Z])/, "")
    .replace(/Ids?$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words || "field";
}

const FIELD_NOUN: Record<string, string> = {
  title: "title",
  name: "name",
  status: "status",
  priority: "priority",
  startDate: "start date",
  dueDate: "due date",
  section: "section",
  sectionId: "section",
  epic: "epic",
  epicId: "epic",
  parent: "parent task",
  parentId: "parent task",
  parentTaskId: "parent task",
  mitigationPlan: "mitigation plan",
  contingencyPlan: "contingency plan",
  assignee: "assignee",
  assignedTo: "assignee",
  assignedToId: "assignee",
  customer: "customer",
  customerId: "customer",
  itopTicketRef: "iTop ticket",
  probability: "probability",
  impact: "impact",
  category: "category",
};

function fieldNoun(field: string): string {
  return Object.prototype.hasOwnProperty.call(FIELD_NOUN, field)
    ? FIELD_NOUN[field]
    : humanizeField(field);
}

/**
 * Display text for one side of a change, or null when there is nothing worth
 * showing (a bare foreign-key id, an unreadable object). `null` values read
 * "none".
 */
function valueText(field: string, entityType: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (isRecord(v)) {
    for (const key of ["username", "name", "title"]) {
      const inner = v[key];
      if (typeof inner === "string" && inner) return clip(inner);
    }
    return null;
  }
  if (typeof v === "number") {
    // Ids (section, epic, parent, customer...) name nothing readable.
    if (/Id$/.test(field)) return null;
    return String(v);
  }
  if (typeof v !== "string") return null;
  if (field === "status") {
    if (entityType === "project") return lookup(PROJECT_STATUS_LABEL, v);
    if (entityType === "risk") return lookup(RISK_STATUS_LABEL, v);
    return lookup(TASK_STATUS_LABEL, v);
  }
  if (field === "priority") return lookup(PRIORITY_LABEL, v);
  if (field === "category") return lookup(RISK_CATEGORY_LABEL, v);
  if (/date$/i.test(field)) return fmtDay(v) || clip(v);
  return clip(v);
}

interface Delta {
  from: unknown;
  to: unknown;
  hasFrom: boolean;
  hasTo: boolean;
}

function asDelta(v: unknown): Delta | null {
  if (!isRecord(v)) return null;
  const hasFrom = "from" in v;
  const hasTo = "to" in v;
  if (!hasFrom && !hasTo) return null;
  return { from: v.from, to: v.to, hasFrom, hasTo };
}

/** " from A to B", " to B" (from unreadable) or "" when nothing is readable. */
function deltaTail(field: string, entityType: string, d: Delta): string {
  const from = d.hasFrom ? valueText(field, entityType, d.from) : null;
  const to = d.hasTo ? valueText(field, entityType, d.to) : null;
  if (from !== null && to !== null) return ` from ${from} to ${to}`;
  if (to !== null) return ` to ${to}`;
  return "";
}

function nameList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((n) => (typeof n === "string" ? n : isRecord(n) && typeof n.name === "string" ? n.name : ""))
    .filter((n) => n !== "")
    .map(clip);
}

function labelChangeClause(v: unknown): string | null {
  if (!isRecord(v)) return null;
  const added = nameList(v.added);
  const removed = nameList(v.removed);
  const bits: string[] = [];
  if (added.length) bits.push(`added ${added.join(", ")}`);
  if (removed.length) bits.push(`removed ${removed.join(", ")}`);
  return bits.length ? bits.join("; ") : null;
}

function isDescriptionChange(field: string): boolean {
  return field === "description" || field === "notes";
}

/** One "status from To do to Done"-style clause for the multi-field form. */
function fieldClause(field: string, entityType: string, raw: unknown): string {
  if (isDescriptionChange(field)) return `${fieldNoun(field)} updated`;
  if (field === "labels") {
    const l = labelChangeClause(raw);
    return l ? `labels ${l}` : "labels changed";
  }
  const noun = fieldNoun(field);
  const d = asDelta(raw);
  if (d) return `${noun}${deltaTail(field, entityType, d)}`;
  return `${noun} changed`;
}

const FLAG_FIELDS = new Set(["isMilestone", "isCriticalPath"]);

/** Single-field task sentences with their own phrasing. Null = use the generic form. */
function taskFieldSentence(field: string, raw: unknown, label: string | null): Parts | null {
  const d = asDelta(raw);
  const subject = label ? ent(label) : txt("a task");
  if (field === "description" || field === "notes") {
    return [txt("updated the description of "), subject];
  }
  if (field === "labels") {
    const l = labelChangeClause(raw);
    return [txt("changed the labels on "), subject, ...(l ? [txt(` (${l})`)] : [])];
  }
  if (FLAG_FIELDS.has(field) && d) {
    const on = d.to === true;
    if (field === "isMilestone") {
      return [txt(on ? "marked " : "unmarked "), subject, txt(" as a milestone")];
    }
    return [txt(on ? "added " : "removed "), subject, txt(on ? " to the critical path" : " from the critical path")];
  }
  if (field === "title" && d) {
    const to = valueText("title", "task", d.to);
    if (to !== null && to !== "none") return [txt("renamed the task "), subject, txt(" to "), ent(to)];
    return null;
  }
  if ((field === "assignee" || field === "assignedTo" || field === "assignedToId") && d) {
    const from = valueText("assignee", "task", d.from);
    const to = valueText("assignee", "task", d.to);
    if (to !== null && to !== "none") {
      return from !== null && from !== "none"
        ? [txt("reassigned "), subject, txt(` from ${from} to ${to}`)]
        : [txt("assigned "), subject, txt(` to ${to}`)];
    }
    if (to === "none") {
      return [txt("unassigned "), subject, ...(from && from !== "none" ? [txt(` (was ${from})`)] : [])];
    }
    return [txt("changed the assignee of "), subject];
  }
  if (d && /date$/i.test(field)) {
    const noun = fieldNoun(field);
    const from = valueText(field, "task", d.from);
    const to = valueText(field, "task", d.to);
    if (to === "none" && from !== null && from !== "none") {
      return [txt(`cleared the ${noun} of `), subject, txt(` (was ${from})`)];
    }
    if (from === "none" && to !== null) {
      return [txt(`set the ${noun} of `), subject, txt(` to ${to}`)];
    }
  }
  return null;
}

function genericFieldSentence(
  entityLabel: string | null,
  entityType: string,
  field: string,
  raw: unknown,
  what: string,
): Parts {
  const noun = fieldNoun(field);
  const d = asDelta(raw);
  const tail = d ? deltaTail(field, entityType, d) : "";
  const subject = entityLabel ? [ent(entityLabel)] : [txt(what)];
  return [txt(`changed the ${noun} of `), ...subject, txt(tail)];
}

function updateSentence(
  event: ActivityEvent,
  changes: Changes,
  what: string,
  subjectNoun: string,
): Parts {
  const label = event.entityLabel;
  const fields = Object.keys(changes);
  const subject: Parts = label ? [ent(label)] : [txt(what)];
  if (fields.length === 0) return [txt("updated "), ...subject];
  if (fields.length === 1) {
    const field = fields[0];
    if (event.entityType === "task") {
      const special = taskFieldSentence(field, changes[field], label);
      if (special) return special;
    }
    if (event.entityType === "project" && field === "name") {
      const d = asDelta(changes[field]);
      const from = d ? valueText("name", "project", d.from) : null;
      const to = d ? valueText("name", "project", d.to) : null;
      if (from && to && from !== "none" && to !== "none") {
        return [txt("renamed the project from "), ent(from), txt(" to "), ent(to)];
      }
      return [txt("renamed the project")];
    }
    if (event.entityType === "project") {
      const noun = fieldNoun(field);
      const d = asDelta(changes[field]);
      return [txt(`changed the project ${noun}${d ? deltaTail(field, "project", d) : ""}`)];
    }
    if (isDescriptionChange(field)) return [txt(`updated the description of `), ...subject];
    return genericFieldSentence(label, event.entityType, field, changes[field], what);
  }
  if (fields.length > 3) {
    return [txt(`updated ${fields.length} fields of `), ...subject];
  }
  const clauses = fields.map((f) => fieldClause(f, event.entityType, changes[f]));
  const lead = event.entityType === "project" ? [txt(`updated the ${subjectNoun}`)] : [txt("updated "), ...subject];
  return [...lead, txt(`: ${clauses.join(", ")}`)];
}

function noteKind(changes: Changes | null): string {
  const raw = changes?.visibility;
  const v = isRecord(raw) ? (raw.to ?? raw.from) : raw;
  if (v === "INTERNAL") return "an internal note";
  if (v === "CUSTOMER_FACING") return "a customer-facing note";
  return "a note";
}

function noteVisibilityLabel(v: unknown): string | null {
  if (v === "INTERNAL") return "internal";
  if (v === "CUSTOMER_FACING") return "customer-facing";
  return null;
}

function genericSentence(event: ActivityEvent): Parts {
  const action = typeof event.action === "string" && event.action ? event.action : "changed";
  const kind = typeof event.entityType === "string" && event.entityType ? event.entityType : "item";
  const label = typeof event.entityLabel === "string" && event.entityLabel ? event.entityLabel : null;
  return [txt(`${action} ${label ? `the ${kind} ` : `a ${kind}`}`), ...(label ? [ent(label)] : [])];
}

function buildBody(event: ActivityEvent): Parts {
  const changes = isRecord(event.changes) ? event.changes : null;
  const label = typeof event.entityLabel === "string" && event.entityLabel ? event.entityLabel : null;
  const named = (verb: string, noun: string, fallback: string): Parts =>
    label ? [txt(`${verb} the ${noun} `), ent(label)] : [txt(`${verb} ${fallback}`)];

  switch (event.entityType) {
    case "task":
      if (event.action === "created") {
        const assignee = changes ? asDelta(changes.assignee) : null;
        const who = assignee ? valueText("assignee", "task", assignee.to) : null;
        return [
          ...named("created", "task", "a task"),
          ...(who && who !== "none" ? [txt(`, assigned to ${who}`)] : []),
        ];
      }
      if (event.action === "deleted") return named("deleted", "task", "a task");
      if (event.action === "updated") {
        return updateSentence({ ...event, entityLabel: label }, changes ?? {}, "a task", "task");
      }
      break;
    case "comment": {
      const on: Parts = label ? [txt(" on "), ent(label)] : [];
      if (event.action === "created") return [txt("commented"), ...(label ? on : [txt(" on a task")])];
      if (event.action === "updated") return [txt("edited a comment"), ...on];
      if (event.action === "deleted") return [txt("deleted a comment"), ...on];
      break;
    }
    case "risk":
      if (event.action === "created") return named("added", "risk", "a risk");
      if (event.action === "deleted") return named("deleted", "risk", "a risk");
      if (event.action === "updated") {
        const fields = changes ? Object.keys(changes) : [];
        if (fields.length === 1 && !isDescriptionChange(fields[0])) {
          const noun = fieldNoun(fields[0]);
          const d = asDelta(changes?.[fields[0]]);
          const tail = d ? deltaTail(fields[0], "risk", d) : "";
          // `{ changed: true }` carries no from/to (plans are long text).
          const verb = d ? "changed" : "updated";
          return [txt(`${verb} the ${noun} of the risk `), ...(label ? [ent(label)] : [txt("")]), txt(tail)];
        }
        return updateSentence({ ...event, entityLabel: label }, changes ?? {}, "a risk", "risk");
      }
      break;
    case "note": {
      if (event.action === "created") return [txt(`added ${noteKind(changes)}`)];
      if (event.action === "deleted") return [txt(`deleted ${noteKind(changes)}`)];
      if (event.action === "updated") {
        const d = asDelta(changes?.visibility);
        const from = d ? noteVisibilityLabel(d.from) : null;
        const to = d ? noteVisibilityLabel(d.to) : null;
        if (from && to && from !== to) return [txt(`changed a note from ${from} to ${to}`)];
        return [txt(`edited ${noteKind(changes)}`)];
      }
      break;
    }
    case "member":
      if (event.action === "added") {
        return label
          ? [txt("added "), ent(label), txt(" to the project")]
          : [txt("added a member to the project")];
      }
      if (event.action === "removed") {
        const n = changes?.unassignedTasks;
        const unassigned =
          typeof n === "number" && n > 0 ? [txt(` (unassigned ${n} ${n === 1 ? "task" : "tasks"})`)] : [];
        return [
          ...(label
            ? [txt("removed "), ent(label), txt(" from the project")]
            : [txt("removed a member from the project")]),
          ...unassigned,
        ];
      }
      break;
    case "share_link": {
      // Never the token: the log holds only the label. Unlabelled links read
      // "a guest link".
      const link: Parts = label ? [txt("the guest link "), ent(label)] : [txt("a guest link")];
      if (event.action === "created") return [txt("created "), ...link];
      if (event.action === "removed" || event.action === "deleted") return [txt("revoked "), ...link];
      break;
    }
    case "project":
      if (event.action === "created") return label ? [txt("created the project "), ent(label)] : [txt("created the project")];
      if (event.action === "updated") {
        return updateSentence({ ...event, entityLabel: null }, changes ?? {}, "the project", "project");
      }
      if (event.action === "deleted") return [txt("deleted the project")];
      break;
    default:
      break;
  }
  return genericSentence(event);
}

/** Task id an event links to: only task events, and never a deleted task. */
export function eventTaskId(event: ActivityEvent): number | null {
  if (event.entityType === "task" && event.action !== "deleted") {
    return Number.isInteger(event.entityId) ? event.entityId : null;
  }
  // Comment events may carry the task they belong to; entityId is the comment.
  if (event.entityType === "comment" && event.action !== "deleted" && isRecord(event.changes)) {
    const id = event.changes.taskId;
    if (typeof id === "number" && Number.isInteger(id)) return id;
  }
  return null;
}

/** One event as parts (actor first) and plain text. Never throws. */
export function describeActivity(event: ActivityEvent): ActivitySentence {
  const actor = event.actor?.username || "Someone";
  let body: Parts;
  try {
    body = buildBody(event);
  } catch {
    body = [txt("made a change")];
  }
  const parts: Parts = [{ kind: "actor", text: actor }, txt(" "), ...body];
  return {
    parts: parts.filter((p) => p.text !== ""),
    text: parts.map((p) => p.text).join("").replace(/\s+/g, " ").trim(),
    taskId: eventTaskId(event),
  };
}
