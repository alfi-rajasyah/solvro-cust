import type { Task } from "@/lib/queries";

/** Story points are whole numbers 0-100, the same range the API accepts. */
export const STORY_POINTS_MAX = 100;

export const STORY_POINTS_ERROR = "Story points must be a whole number from 0 to 100.";

export type StoryPointsParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Parses a text field: empty is "not estimated" (null); anything else must be a whole number 0-100. */
export function parseStoryPoints(raw: string): StoryPointsParse {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: STORY_POINTS_ERROR };
  const n = Number(text);
  if (n > STORY_POINTS_MAX) return { ok: false, error: STORY_POINTS_ERROR };
  return { ok: true, value: n };
}

export interface StoryPointTotals {
  total: number;
  done: number;
  /** How many top-level tasks carry an estimate (0 counts), so "all zero" differs from "none estimated". */
  estimated: number;
}

/**
 * Sum of story points over top-level tasks only (subtasks do not count) and
 * the part of it in done-category tasks. Unestimated tasks add nothing.
 */
export function sumStoryPoints(
  tasks: Pick<Task, "parentTaskId" | "status" | "storyPoints">[],
): StoryPointTotals {
  let total = 0;
  let done = 0;
  let estimated = 0;
  for (const t of tasks) {
    if (t.parentTaskId !== null || t.storyPoints == null) continue;
    estimated += 1;
    total += t.storyPoints;
    if (t.status === "DONE") done += t.storyPoints;
  }
  return { total, done, estimated };
}

/** Story point totals per epic id, from the loaded task list (top-level tasks only). */
export function storyPointTotalsByEpic(
  tasks: Pick<Task, "parentTaskId" | "status" | "storyPoints" | "epicId">[],
): Map<number, StoryPointTotals> {
  const byEpic = new Map<number, Pick<Task, "parentTaskId" | "status" | "storyPoints">[]>();
  for (const t of tasks) {
    if (t.epicId == null) continue;
    const list = byEpic.get(t.epicId);
    if (list) list.push(t);
    else byEpic.set(t.epicId, [t]);
  }
  return new Map([...byEpic].map(([id, list]) => [id, sumStoryPoints(list)]));
}
