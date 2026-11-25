import { ApiError } from "@/lib/api";
import { fmtAgo } from "@/lib/formatDate";
import { WEBHOOK_EVENT_LABEL } from "@/lib/labels";
import { WEBHOOK_EVENT_TYPES, type Webhook } from "@/lib/queries";

/** Most projects one webhook can name; the API refuses more. */
export const WEBHOOK_MAX_PROJECTS = 50;

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

/** The API's own sentence (webhook_target_refused, webhook_limit, project_not_found, ...), else a fallback. */
export function webhookErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}
