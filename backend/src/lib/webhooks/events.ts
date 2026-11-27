// Allow-list mapping from an activity row to webhook event types. A row that
// matches no line maps to nothing (the dispatcher still stamps it as handled).
// Notes, members, epics and share links never map, and the only deletion that
// maps is a comment's (it carries no text), so an INTERNAL
// note can never reach a webhook (root CLAUDE.md Guardrails).
import type { WebhookEventType } from "./eventTypes.js";

export interface ActivityRowForMapping {
  entityType: string;
  action: string;
  changes: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** True when `changes.assignee` names a new assignee (its `to` is an object, not null). */
function assigneeSet(changes: Record<string, unknown> | null): boolean {
  const assignee = asRecord(changes?.assignee);
  return assignee !== null && asRecord(assignee.to) !== null;
}

/**
 * The event types for one activity row, in the order a subscription picks
 * from when it subscribes to more than one of them. `statusIsDone` is the
 * category of the status the row moved to being DONE (the dispatcher resolves
 * the recorded status name against task_status_defs).
 */
export function mapActivityToEvents(row: ActivityRowForMapping, statusIsDone = false): WebhookEventType[] {
  const changes = asRecord(row.changes);
  const events: WebhookEventType[] = [];
  if (row.entityType === "task") {
    if (row.action === "created") {
      events.push("task.created");
      if (assigneeSet(changes)) events.push("task.assigned");
    } else if (row.action === "updated" && changes) {
      if (changes.status !== undefined) {
        events.push("task.status_changed");
        if (statusIsDone) events.push("task.completed");
      }
      if (assigneeSet(changes)) events.push("task.assigned");
      if (changes.startDate !== undefined || changes.dueDate !== undefined) events.push("task.due_date_changed");
    }
  } else if (row.entityType === "comment") {
    if (row.action === "created") events.push("comment.created");
    else if (row.action === "updated") events.push("comment.updated");
    else if (row.action === "deleted") events.push("comment.deleted");
  } else if (row.action === "created") {
    if (row.entityType === "project") events.push("project.created");
    else if (row.entityType === "risk") events.push("risk.created");
  }
  return events;
}

/** The name of the status a task `updated` row moved to (`changes.status.to`), or null. */
export function newStatusName(row: ActivityRowForMapping & { entityType: string; action: string }): string | null {
  if (row.entityType !== "task" || row.action !== "updated") return null;
  const to = asRecord(asRecord(row.changes)?.status)?.to;
  return typeof to === "string" ? to : null;
}
