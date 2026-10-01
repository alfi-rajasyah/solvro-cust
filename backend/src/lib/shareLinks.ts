import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";
import { dayString } from "./activity.js";

// Guest links (docs/archive/plans/collaboration-and-sharing.md, L4): a
// read-only, unauthenticated view of one project's timeline.
//
// PRIVACY INVARIANT (root CLAUDE.md, INTERNAL notes guardrail): the public
// payload is built from an explicit allow-list — project name / customer name /
// status, section names with derived dates + status, and milestone
// title / date / done. It must never carry notes (either visibility), comments,
// risks, people, emails, iTop data, the activity feed, or any detail of a
// non-milestone task. buildPublicSharePayload selects only the columns it
// needs so a new Task/Project column can never leak by accident.

export const SHARE_LABEL_MAX = 80;
export const SHARE_DEFAULT_EXPIRY_DAYS = 30;
export const SHARE_MAX_EXPIRY_DAYS = 90;
/** `lastUsedAt` is refreshed at most this often per link. */
export const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

/** Shape of every token we issue (32 bytes, base64url, unpadded). */
export const SHARE_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, base64url — shown to the owner exactly once. */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex. Only this is stored; every lookup goes by hash, never by token. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type PhaseStatus = "done" | "in_progress" | "not_started";

export interface PublicPhase {
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: PhaseStatus;
}

export interface PublicMilestone {
  title: string;
  date: string;
  done: boolean;
}

export interface PublicSharePayload {
  project: { name: string; customerName: string | null; status: string };
  phases: PublicPhase[];
  milestones: PublicMilestone[];
  generatedAt: string;
}

interface PhaseTaskFacts {
  status: "TODO" | "IN_PROGRESS" | "DONE";
  startDate: Date | null;
  dueDate: Date | null;
}

/**
 * One phase from its tasks. Start = earliest start (a task without one falls
 * back to its due date), end = latest due (falling back to start). Done when
 * every task is DONE, not started when every task is TODO, in progress
 * otherwise. No tasks -> null dates, not started.
 */
export function derivePhase(name: string, tasks: PhaseTaskFacts[]): PublicPhase {
  let start: Date | null = null;
  let end: Date | null = null;
  for (const t of tasks) {
    const s = t.startDate ?? t.dueDate;
    const e = t.dueDate ?? t.startDate;
    if (s && (!start || s < start)) start = s;
    if (e && (!end || e > end)) end = e;
  }
  let status: PhaseStatus = "in_progress";
  if (tasks.length === 0 || tasks.every((t) => t.status === "TODO")) status = "not_started";
  else if (tasks.every((t) => t.status === "DONE")) status = "done";
  return { name, startDate: dayString(start), endDate: dayString(end), status };
}

export async function buildPublicSharePayload(
  projectId: number,
  now: Date = new Date(),
): Promise<PublicSharePayload | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      status: true,
      customer: { select: { name: true } },
      sections: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          name: true,
          tasks: { select: { status: true, startDate: true, dueDate: true } },
        },
      },
      tasks: {
        where: { isMilestone: true },
        orderBy: { id: "asc" },
        select: { title: true, status: true, startDate: true, dueDate: true },
      },
    },
  });

  // The link's project vanished between the link lookup and here.
  if (!project) return null;

  const milestones: PublicMilestone[] = [];
  for (const m of project.tasks) {
    // A milestone's date is its due date (start as a fallback). One with
    // neither has nothing to show a guest on a timeline, so it is left out.
    const date = dayString(m.dueDate ?? m.startDate);
    if (date) milestones.push({ title: m.title, date, done: m.status === "DONE" });
  }
  // yyyy-mm-dd sorts chronologically as text; the stable sort keeps id order on ties.
  milestones.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    project: {
      name: project.name,
      customerName: project.customer?.name ?? null,
      status: project.status,
    },
    phases: project.sections.map((s) => derivePhase(s.name, s.tasks)),
    milestones,
    generatedAt: now.toISOString(),
  };
}

/**
 * Finds a link that is usable right now (exists, not revoked, not expired) by
 * the hash of the presented token; null otherwise. Callers must answer every
 * null identically so the three failure states cannot be told apart.
 */
export async function findActiveShareLink(token: string, now: Date = new Date()) {
  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashShareToken(token) },
    select: { id: true, projectId: true, expiresAt: true, revokedAt: true },
  });
  if (!link || link.revokedAt !== null || link.expiresAt <= now) return null;
  return link;
}

/** Bumps `lastUsedAt` unless it was already refreshed within the last hour. */
export async function touchShareLink(linkId: number, now: Date = new Date()): Promise<void> {
  await prisma.shareLink.updateMany({
    where: {
      id: linkId,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_REFRESH_MS) } }],
    },
    data: { lastUsedAt: now },
  });
}
