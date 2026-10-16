// Sentence and link for one in-app notification
// (docs/archive/plans/collaboration-and-sharing.md, C5b). Pure and total, like
// `activityText.ts`, whose event shapes and task-id rule it reuses.
import { type ActivityPart, describeActivity, eventTaskId } from "@/lib/activityText";
import type { AppNotification } from "@/lib/queries";

export interface NotificationSentence {
  parts: ActivityPart[];
  /** The whole sentence as plain text. */
  text: string;
}

const REASON_PHRASE: Record<string, { before: string }> = {
  assigned: { before: "assigned you " },
  commented: { before: "commented on " },
  mentioned: { before: "mentioned you on " },
};

/**
 * A project created with you as its TAM, or handed to you: "rina made you TAM
 * of Acme rollout". A missing project name falls back to the activity sentence.
 */
function describeProjectRoleNotification(n: AppNotification, actor: string): NotificationSentence | null {
  const project =
    (typeof n.projectName === "string" && n.projectName) ||
    (typeof n.event.entityLabel === "string" && n.event.entityLabel) ||
    null;
  if (!project) return null;
  const parts: ActivityPart[] = [
    { kind: "actor", text: actor },
    { kind: "text", text: " made you TAM of " },
    { kind: "entity", text: project },
  ];
  return { parts, text: parts.map((p) => p.text).join("") };
}

/**
 * "rina assigned you Task", "rina commented on Task", "rina mentioned you on
 * Task"; for a project seat "rina made you TAM of Acme rollout". An unknown
 * reason, or no title to name, falls back to the activity sentence for the
 * underlying event.
 */
export function describeNotification(n: AppNotification): NotificationSentence {
  if (n.event?.entityType === "project" && n.reason === "assigned") {
    const sentence = describeProjectRoleNotification(n, n.event.actor?.username || "Someone");
    if (sentence) return sentence;
  }
  const phrase = Object.prototype.hasOwnProperty.call(REASON_PHRASE, n.reason)
    ? REASON_PHRASE[n.reason]
    : null;
  const label = typeof n.event?.entityLabel === "string" && n.event.entityLabel ? n.event.entityLabel : null;
  if (!phrase || !label) {
    const { parts, text } = describeActivity(n.event);
    return { parts, text };
  }
  const actor = n.event.actor?.username || "Someone";
  const parts: ActivityPart[] = [
    { kind: "actor", text: actor },
    { kind: "text", text: ` ${phrase.before}` },
    { kind: "entity", text: label },
  ];
  return { parts, text: parts.map((p) => p.text).join("") };
}

/** Where a notification leads: the task panel when the task is known, else the project. */
export function notificationHref(n: AppNotification): string {
  const taskId = eventTaskId(n.event);
  return taskId !== null ? `/projects/${n.projectId}?task=${taskId}` : `/projects/${n.projectId}`;
}
