import { ApiError } from "@/lib/api";
import { EMPTY_VALUE } from "@/lib/emptyValue";
import { fmtAgo } from "@/lib/formatDate";
import { WEBHOOK_EVENT_TYPES, type Webhook, type WebhookDelivery, type WebhookFormat } from "@/lib/queries";

export const WEBHOOK_EVENT_LABEL: Record<string, string> = {
  "task.created": "Task created",
  "task.status_changed": "Task status changed",
  "task.assigned": "Task assigned",
  "task.due_date_changed": "Task due date changed",
  "task.completed": "Task completed",
  "comment.created": "Comment added",
  "project.created": "Project created",
  "risk.created": "Risk added",
};

export const WEBHOOK_FORMAT_LABEL: Record<WebhookFormat, string> = {
  STANDARD: "Standard Webhooks",
  GOOGLE_CHAT: "Google Chat",
};

/** Most projects one webhook can name; the API refuses more. */
export const WEBHOOK_MAX_PROJECTS = 50;

/** Host only: the full URL can carry a Google Chat key and token, so the list never prints it. */
export function webhookHost(url: string): string {
  try {
    return new URL(url).host || EMPTY_VALUE;
  } catch {
    return EMPTY_VALUE;
  }
}

/** Events in contract order, as human labels. */
export function eventLabels(eventTypes: string[]): string[] {
  const known = WEBHOOK_EVENT_TYPES.filter((e) => eventTypes.includes(e));
  const unknown = eventTypes.filter((e) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e));
  return [...known, ...unknown].map((e) => WEBHOOK_EVENT_LABEL[e] ?? e);
}

/** Compact list text: every event, the labels when there are one or two, else a count. */
export function eventsSummary(eventTypes: string[]): string {
  if (eventTypes.length >= WEBHOOK_EVENT_TYPES.length) return "All events";
  const labels = eventLabels(eventTypes);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]} and ${labels.length - 1} more`;
}

export function projectsSummary(projectIds: number[]): string {
  if (projectIds.length === 0) return "All visible projects";
  return projectIds.length === 1 ? "1 project" : `${projectIds.length} projects`;
}

export function lastDeliveryText(last: Webhook["lastDelivery"]): string {
  if (!last) return "No deliveries yet";
  const when = fmtAgo(last.at);
  if (last.status === "PENDING") return `Pending, queued ${when}`;
  const code = last.statusCode != null ? ` (${last.statusCode})` : "";
  return `${last.status === "SUCCEEDED" ? "Delivered" : "Failed"}${code}, ${when}`;
}

export const DELIVERY_STATUS_LABEL: Record<WebhookDelivery["status"], string> = {
  PENDING: "Pending",
  SUCCEEDED: "Delivered",
  FAILED: "Failed",
};

/** The API's own sentence (webhook_target_refused, webhook_limit, project_not_found, ...), else a fallback. */
export function webhookErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}
