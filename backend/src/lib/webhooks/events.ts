// Allow-list mapping from an activity row to webhook event types. A row that
// matches no line maps to nothing (the dispatcher still stamps it as handled).
// Notes, members, epics, share links and deletions never map, so an INTERNAL
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
 * from when it subscribes to more than one of them. `taskIsDone` is the
 * task's current status category being DONE (the dispatcher looks it up for
 * task `updated` rows that changed status).
 */
export function mapActivityToEvents(row: ActivityRowForMapping, taskIsDone = false): WebhookEventType[] {
  const changes = asRecord(row.changes);
  const events: WebhookEventType[] = [];
  if (row.entityType === "task") {
    if (row.action === "created") {
      events.push("task.created");
      if (assigneeSet(changes)) events.push("task.assigned");
    } else if (row.action === "updated" && changes) {
      if (changes.status !== undefined) {
        events.push("task.status_changed");
        if (taskIsDone) events.push("task.completed");
      }
      if (assigneeSet(changes)) events.push("task.assigned");
      if (changes.startDate !== undefined || changes.dueDate !== undefined) events.push("task.due_date_changed");
    }
  } else if (row.action === "created") {
    if (row.entityType === "comment") events.push("comment.created");
    else if (row.entityType === "project") events.push("project.created");
    else if (row.entityType === "risk") events.push("risk.created");
  }
  return events;
}

/** Whether the row needs the task's current status category to map (see `mapActivityToEvents`). */
export function needsTaskCategory(row: ActivityRowForMapping): boolean {
  const changes = asRecord(row.changes);
  return row.entityType === "task" && row.action === "updated" && changes?.status !== undefined;
}
