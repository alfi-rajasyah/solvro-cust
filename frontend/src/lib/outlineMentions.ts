// Copy and counting for "Mentioned in Outline" (task panel, project Overview).
// The server answers either
//   { connected: true,  visible: [...], hiddenCount }   - the viewer's own Outline
//                                                         account decided what is visible
//   { connected: false, total }                          - no usable Outline connection:
//                                                         a count and no titles
// (docs/archive/plans/outline-integration.md, D5). `total` is absent on the
// connected-false answer for a page with no mentions at all.

export interface OutlineMentionDoc {
  docId: string;
  title: string;
  url: string;
}

export interface OutlineMentionsData {
  connected: boolean;
  total?: number;
  visible?: OutlineMentionDoc[];
  hiddenCount?: number;
}

/** Pages that mention the task/project, whether or not the viewer may open them. */
export function mentionsTotal(data: OutlineMentionsData): number {
  if (data.connected) return (data.visible?.length ?? 0) + (data.hiddenCount ?? 0);
  return data.total ?? (data.visible?.length ?? 0) + (data.hiddenCount ?? 0);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "N more pages you cannot open" - never names the pages. */
export function hiddenPagesCopy(n: number): string {
  return `${n} more ${plural(n, "page", "pages")} you cannot open`;
}

/** The sentence before the "connect Outline" link for a viewer without a connection. */
export function unconnectedLead(total: number): string {
  return `Mentioned in ${total} Outline ${plural(total, "page", "pages")} — `;
}

/** The link text that finishes it: "connect Outline to see them". */
export function unconnectedAction(total: number): string {
  return `connect Outline to see ${plural(total, "it", "them")}`;
}

export const TASK_MENTIONS_HELP = "Updates when someone pastes this task's link into an Outline page.";
export const PROJECT_MENTIONS_HELP =
  "Updates when someone pastes a link to this project or one of its tasks into an Outline page.";
