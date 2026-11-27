// The outgoing webhook event types (docs/archive/plans/webhooks.md). The order
// here is the order the Settings UI lists them in. There are no note events:
// INTERNAL notes never leave Solvro (root CLAUDE.md Guardrails).
export const WEBHOOK_EVENT_TYPES = [
  "task.created",
  "task.status_changed",
  "task.assigned",
  "task.due_date_changed",
  "task.completed",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "project.created",
  "risk.created",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Sent only by the "Send test" action; never produced from activity and never subscribable. */
export const WEBHOOK_TEST_EVENT = "webhook.test";
