// Pure helpers for the Outline embed views (/embed/projects/:id/*,
// docs/archive/plans/outline-integration.md, Phase C). No React, no I/O.
import { dayFromIso } from "@/lib/dateField";
import { isTaskOverdue } from "@/lib/formatDate";
import type { Section, Task } from "@/lib/queries";
import type { PublicPhaseStatus } from "@/lib/queries";

export const EMBED_DEFAULT_LIMIT = 10;
export const EMBED_MAX_LIMIT = 50;

/** `?limit=` — a positive whole number, capped; anything else is the default. */
export function parseEmbedLimit(raw: string | null | undefined): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return EMBED_DEFAULT_LIMIT;
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n) || n < 1) return EMBED_DEFAULT_LIMIT;
  return Math.min(n, EMBED_MAX_LIMIT);
}

/** `?epic=` — a positive whole number, or null when absent or malformed. */
export function parseEmbedEpicId(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The tasks the table speaks about: top-level only (a subtask is a detail of
 * its parent and never carries an epic), narrowed to one epic when given.
 */
export function embedTaskScope(tasks: readonly Task[], epicId: number | null): Task[] {
  return tasks.filter((t) => t.parentTaskId === null && (epicId === null || t.epicId === epicId));
}

export function embedTaskCounts(tasks: readonly Pick<Task, "status">[]): {
  done: number;
  total: number;
} {
  return { done: tasks.filter((t) => t.status === "DONE").length, total: tasks.length };
}

/**
 * Table order: overdue open tasks first (longest overdue on top), then open
 * tasks by due date with undated ones after, then finished tasks by due date.
 * Ties fall back to the task id so the order is stable across refreshes.
 */
export function sortEmbedTasks<T extends Pick<Task, "id" | "status" | "dueDate">>(
  tasks: readonly T[],
  todayDay: string | null,
): T[] {
  const group = (t: T): number => {
    if (t.status === "DONE") return 3;
    if (isTaskOverdue(t.status, t.dueDate, todayDay)) return 0;
    return dayFromIso(t.dueDate) ? 1 : 2;
  };
  return [...tasks].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    const da = dayFromIso(a.dueDate) ?? "";
    const db = dayFromIso(b.dueDate) ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return a.id - b.id;
  });
}

export interface EmbedPhase {
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: PublicPhaseStatus;
}

/**
 * Phases are the project's sections; dates and status derive from their tasks
 * the same way the guest timeline does (backend/src/lib/shareLinks.ts
 * `derivePhase`): start = earliest start, end = latest due (each falling back
 * to the other), done when every task is done, not started when every task is
 * to do or there are none.
 */
export function deriveEmbedPhases(sections: readonly Section[], tasks: readonly Task[]): EmbedPhase[] {
  return [...sections]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((section) => {
      const own = tasks.filter((t) => t.sectionId === section.id);
      let start: string | null = null;
      let end: string | null = null;
      for (const t of own) {
        const s = dayFromIso(t.startDate) ?? dayFromIso(t.dueDate);
        const e = dayFromIso(t.dueDate) ?? dayFromIso(t.startDate);
        if (s && (!start || s < start)) start = s;
        if (e && (!end || e > end)) end = e;
      }
      let status: PublicPhaseStatus = "in_progress";
      if (own.length === 0 || own.every((t) => t.status === "TODO")) status = "not_started";
      else if (own.every((t) => t.status === "DONE")) status = "done";
      return { name: section.name, startDate: start, endDate: end, status };
    });
}

/** The earliest open milestone dated today or later; falls back to the earliest overdue one. */
export function nextMilestone<T extends Pick<Task, "id" | "isMilestone" | "status" | "dueDate" | "startDate">>(
  tasks: readonly T[],
  todayDay: string | null,
): T | null {
  const dayOf = (t: T) => dayFromIso(t.dueDate) ?? dayFromIso(t.startDate);
  const open = tasks.filter((t) => t.isMilestone && t.status !== "DONE" && dayOf(t) !== null);
  const byDay = (a: T, b: T) => (dayOf(a)! < dayOf(b)! ? -1 : dayOf(a)! > dayOf(b)! ? 1 : a.id - b.id);
  const upcoming = open.filter((t) => todayDay === null || dayOf(t)! >= todayDay).sort(byDay);
  if (upcoming.length > 0) return upcoming[0];
  return open.sort(byDay)[0] ?? null;
}

/** Where "Sign in" opens: the login page in a top-level tab, returning to the embed path. */
export function embedSignInHref(embedPath: string): string {
  return `/login?from=${encodeURIComponent(embedPath)}`;
}

/** Where a row or the footer opens in Solvro. */
export function embedOpenHref(projectId: number, taskId?: number): string {
  return taskId === undefined
    ? `/projects/${projectId}`
    : `/projects/${projectId}/list?task=${taskId}`;
}

/** Schedule wording shared with the project header facts and Daily Review. */
export function embedScheduleLabel(slipDays: number | null | undefined): string {
  if (slipDays === null || slipDays === undefined) return "No baseline";
  if (slipDays > 0) return `${slipDays}d behind`;
  if (slipDays < 0) return `${-slipDays}d ahead`;
  return "On schedule";
}

/** `?embed=1` on a guest link: the compact, chrome-free rendering. Only the exact value "1". */
export function isGuestEmbed(raw: string | null | undefined): boolean {
  return raw === "1";
}

export type EmbedView = "tasks" | "status" | "timeline";

export const EMBED_VIEWS: readonly { id: EmbedView; label: string; hint: string; icon: string }[] = [
  { id: "tasks", label: "Task table", hint: "Open tasks, overdue first", icon: "table_rows" },
  { id: "status", label: "Status card", hint: "Progress, health, next milestone", icon: "monitor_heart" },
  { id: "timeline", label: "Timeline", hint: "Phases as read-only bars", icon: "timeline" },
];

/**
 * The signed-in embed link a TAM pastes into Outline. Only the task table
 * takes a filter, so `epicId` is ignored for the other views.
 */
export function buildEmbedUrl(
  origin: string,
  projectId: number,
  view: EmbedView,
  epicId: number | null = null,
): string {
  const base = `${origin.replace(/\/+$/, "")}/embed/projects/${projectId}/${view}`;
  return view === "tasks" && epicId !== null ? `${base}?epic=${epicId}` : base;
}

/** The guest embed link: a guest link's own URL plus `?embed=1` (guests see the timeline only). */
export function buildGuestEmbedUrl(shareUrl: string): string {
  return `${shareUrl}${shareUrl.includes("?") ? "&" : "?"}embed=1`;
}
