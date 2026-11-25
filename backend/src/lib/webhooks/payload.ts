// Payload builders. `data` is assembled at delivery time from allow-listed
// columns, never from a whole row: a task never sends its description, a
// comment sends its first 500 characters only, a risk never sends its plans.
// Activity `changes` carry no free text by design (lib/activity.ts), and only
// the allow-listed keys per event are copied here.
import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../env.js";
import { dayString } from "../activity.js";
import type { WebhookEventType } from "./eventTypes.js";
import { WEBHOOK_TEST_EVENT } from "./eventTypes.js";

type Db = Prisma.TransactionClient | PrismaClient;

export const COMMENT_EXCERPT_CHARS = 500;

export interface WebhookPayload {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ActivityRowForPayload {
  id: number;
  projectId: number;
  entityType: string;
  entityId: number;
  entityLabel: string | null;
  changes: unknown;
  createdAt: Date;
  actor: { username: string } | null;
}

function appUrl(path: string): string | null {
  return env.APP_URL ? `${env.APP_URL}${path}` : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Characters, not UTF-16 units, so an emoji is never cut in half. */
export function excerpt(text: string, max = COMMENT_EXCERPT_CHARS): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

function usernameOf(value: unknown): string | null {
  return asRecord(value)?.username === undefined ? null : String(asRecord(value)!.username);
}

/** The allow-listed `changes` for an event type; assignee ids are dropped, only usernames stay. */
function sanitizeChanges(type: WebhookEventType, changes: unknown): Record<string, unknown> | undefined {
  const raw = asRecord(changes);
  if (!raw) return undefined;
  const pick = (key: string): Record<string, unknown> | undefined => {
    const v = asRecord(raw[key]);
    if (!v || !("from" in v) || !("to" in v)) return undefined;
    if (key === "assignee") return { from: usernameOf(v.from), to: usernameOf(v.to) };
    return { from: v.from ?? null, to: v.to ?? null };
  };
  const keys: string[] =
    type === "task.status_changed" || type === "task.completed"
      ? ["status"]
      : type === "task.assigned"
        ? ["assignee"]
        : type === "task.due_date_changed"
          ? ["startDate", "dueDate"]
          : [];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const picked = pick(key);
    if (picked) out[key] = picked;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Builds the Standard-format payload for one activity row and one event type. */
export async function buildPayload(db: Db, row: ActivityRowForPayload, type: WebhookEventType): Promise<WebhookPayload> {
  const project = await db.project.findUnique({ where: { id: row.projectId }, select: { id: true, name: true } });
  const data: Record<string, unknown> = {
    project: { id: row.projectId, name: project?.name ?? null, url: appUrl(`/projects/${row.projectId}`) },
  };
  const rowChanges = asRecord(row.changes);

  if (row.entityType === "task" || row.entityType === "comment") {
    const taskId = row.entityType === "task" ? row.entityId : Number(rowChanges?.taskId);
    const task = Number.isInteger(taskId)
      ? await db.task.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            title: true,
            dueDate: true,
            statusDef: { select: { name: true } },
            assignedTo: { select: { username: true } },
          },
        })
      : null;
    data.task = task
      ? {
          id: task.id,
          title: task.title,
          status: task.statusDef.name,
          assignee: task.assignedTo?.username ?? null,
          dueDate: dayString(task.dueDate),
          url: appUrl(`/tasks/${task.id}`),
        }
      : { id: Number.isInteger(taskId) ? taskId : null, title: row.entityLabel, status: null, assignee: null, dueDate: null, url: null };
    if (row.entityType === "comment") {
      const comment = await db.comment.findUnique({ where: { id: row.entityId }, select: { id: true, body: true } });
      data.comment = { id: row.entityId, text: comment ? excerpt(comment.body) : null };
    }
  } else if (row.entityType === "risk") {
    const risk = await db.risk.findUnique({
      where: { id: row.entityId },
      select: { id: true, status: true, probability: true, impact: true },
    });
    data.risk = {
      id: row.entityId,
      title: row.entityLabel,
      status: risk?.status ?? null,
      probability: risk?.probability ?? null,
      impact: risk?.impact ?? null,
    };
  }

  const changes = sanitizeChanges(type, row.changes);
  if (changes) data.changes = changes;
  data.actor = row.actor?.username ?? null;
  return { type, timestamp: row.createdAt.toISOString(), data };
}

/** The payload of the "Send test" action. */
export function buildTestPayload(webhook: { id: number; name: string }, now: Date = new Date()): WebhookPayload {
  return {
    type: WEBHOOK_TEST_EVENT,
    timestamp: now.toISOString(),
    data: { webhook: { id: webhook.id, name: webhook.name }, message: "This is a test event from Solvro." },
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** One plain-text line for Google Chat, built from the same data; no signature, no JSON. */
export function googleChatText(payload: WebhookPayload): string {
  const d = payload.data as {
    project?: { name?: string | null; url?: string | null };
    task?: { title?: string | null; status?: string | null; url?: string | null };
    comment?: { text?: string | null };
    risk?: { title?: string | null };
    changes?: Record<string, { from?: unknown; to?: unknown }>;
    actor?: string | null;
    message?: string;
    webhook?: { name?: string };
  };
  const who = d.actor ?? "Someone";
  const task = d.task?.title ? `"${oneLine(d.task.title)}"` : "a task";
  let line: string;
  switch (payload.type) {
    case "task.created":
      line = `${who} created ${task}`;
      break;
    case "task.status_changed":
      line = `${who} moved ${task} to ${String(d.changes?.status?.to ?? d.task?.status ?? "a new status")}`;
      break;
    case "task.completed":
      line = `${who} completed ${task}`;
      break;
    case "task.assigned":
      line = `${who} assigned ${task} to ${String(d.changes?.assignee?.to ?? "someone")}`;
      break;
    case "task.due_date_changed": {
      const due = d.changes?.dueDate?.to;
      line = `${who} changed the dates of ${task}${due ? `, due ${String(due)}` : ""}`;
      break;
    }
    case "comment.created":
      line = `${who} commented on ${task}${d.comment?.text ? `: ${oneLine(d.comment.text)}` : ""}`;
      break;
    case "project.created":
      line = `${who} created the project "${oneLine(d.project?.name ?? "")}"`;
      break;
    case "risk.created":
      line = `${who} added the risk "${oneLine(d.risk?.title ?? "")}"`;
      break;
    default:
      line = d.message ? `${d.message} (${d.webhook?.name ?? "webhook"})` : payload.type;
  }
  const parts = [line];
  if (payload.type !== "project.created" && d.project?.name) parts.push(oneLine(d.project.name));
  const link = d.task?.url ?? d.project?.url;
  if (link) parts.push(link);
  return parts.join(" · ");
}
