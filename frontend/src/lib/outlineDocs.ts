// Pure helpers for the Outline-inside-Solvro UI (docs/archive/plans/outline-integration.md,
// B6): the copy for the OAuth return parameters, the "Place under" options of the
// New doc dialog, the default title, and the webhook-health reading. No React and
// no data fetching, so it stays unit-testable in the node-env Vitest config.
import { dateToDay } from "@/lib/dateField";
import { fmtDay } from "@/lib/formatDate";
import type { OutlineDocNode } from "@/lib/queries";

// ---- OAuth return (`/settings?outline=…&reason=…`) -------------------------

export type OutlineNoticeTone = "success" | "info" | "error";

export interface OutlineNotice {
  tone: OutlineNoticeTone;
  message: string;
}

const REASON_COPY: Record<string, string> = {
  identity_mismatch:
    "That Outline account uses a different email than your Solvro account. Sign in to Outline with the email you use in Solvro, then try again.",
  already_linked: "That Outline account is already connected to another Solvro user.",
  state: "The connection attempt expired or was already used. Connect again to start over.",
  exchange: "Outline did not accept the sign-in. Connect again to retry.",
  unavailable: "Solvro could not reach Outline. Try again in a moment.",
  not_configured: "Outline is not set up yet. Ask an administrator to finish the Outline settings.",
};

const GENERIC_ERROR = "Could not connect Outline. Try again.";

/** The query parameters the backend's OAuth callback redirects back with. */
export const OUTLINE_RETURN_PARAMS = ["outline", "reason"] as const;

/** The message for a return from Outline's consent screen, or null when the URL carries none. */
export function outlineReturnNotice(params: URLSearchParams): OutlineNotice | null {
  const outcome = params.get("outline");
  if (outcome === null) return null;
  if (outcome === "connected") return { tone: "success", message: "Outline connected." };
  if (outcome === "cancelled") {
    return { tone: "info", message: "Connection cancelled. Nothing was changed." };
  }
  if (outcome === "error") {
    const reason = params.get("reason") ?? "";
    return { tone: "error", message: REASON_COPY[reason] ?? GENERIC_ERROR };
  }
  return null;
}

/** A copy of `params` without the OAuth return parameters (so a reload does not repeat the message). */
export function stripOutlineReturnParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of OUTLINE_RETURN_PARAMS) next.delete(key);
  return next;
}

// ---- New doc dialog --------------------------------------------------------

export interface PlaceOption {
  /** The parent page id, or "" for "top level of the linked collection". */
  value: string;
  label: string;
}

/**
 * The "Place under" choices built from the Docs tree: the anchor itself first
 * (a collection's top level, or the linked page), then every page below it with
 * its path ("Parent › Child") so identical titles stay distinguishable.
 */
export function placeUnderOptions(
  anchor: { kind: "doc" | "collection"; title: string },
  tree: OutlineDocNode[],
): PlaceOption[] {
  const options: PlaceOption[] = [];
  if (anchor.kind === "collection") {
    options.push({ value: "", label: `${anchor.title} (top level)` });
  }
  const walk = (nodes: OutlineDocNode[], trail: string[]) => {
    for (const node of nodes) {
      const path = [...trail, node.title];
      options.push({ value: node.id, label: path.join(" › ") });
      walk(node.children, path);
    }
  };
  // A page anchor's tree is a single root (the anchor): its path starts at the anchor.
  walk(tree, anchor.kind === "collection" ? [anchor.title] : []);
  return options;
}

/** The pre-selected parent: the collection's top level, or the linked page itself. */
export function defaultPlaceValue(anchor: { kind: "doc" | "collection" }, tree: OutlineDocNode[]): string {
  return anchor.kind === "collection" ? "" : (tree[0]?.id ?? "");
}

export const OUTLINE_DOC_TITLE_MAX = 255;

/** "<template> — <date>" (e.g. "Meeting notes — 9 Oct"); a blank page gets "New page — <date>". */
export function defaultDocTitle(templateTitle: string | null, now: Date = new Date()): string {
  const base = (templateTitle ?? "").trim() || "New page";
  // The user's LOCAL day: formatting the ISO instant would show yesterday's date
  // in the early morning east of UTC.
  return `${base} — ${fmtDay(dateToDay(now) ?? "", now)}`.slice(0, OUTLINE_DOC_TITLE_MAX);
}

/** Every page in the tree, parents first. */
export function flattenDocs(tree: OutlineDocNode[]): OutlineDocNode[] {
  const out: OutlineDocNode[] = [];
  const walk = (nodes: OutlineDocNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

// ---- Docs tab states -------------------------------------------------------

/** "Try again in 12 s" / "in 3 min" for a 429's retry-after seconds (null: no hint). */
export function retryAfterText(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "Try again in a moment.";
  if (seconds < 90) return `Try again in ${Math.ceil(seconds)} s.`;
  return `Try again in ${Math.ceil(seconds / 60)} min.`;
}

// ---- Admin webhook health --------------------------------------------------

export const WEBHOOK_STALE_MS = 24 * 60 * 60 * 1000;

export type WebhookHealth = "never" | "stale" | "ok";

/** Whether Outline has delivered recently: never, older than 24 h, or fine. */
export function webhookHealth(lastWebhookAt: string | null, now: Date = new Date()): WebhookHealth {
  if (!lastWebhookAt) return "never";
  const at = new Date(lastWebhookAt).getTime();
  if (Number.isNaN(at)) return "never";
  return now.getTime() - at > WEBHOOK_STALE_MS ? "stale" : "ok";
}

export const WEBHOOK_STALE_COPY =
  "No delivery in 24 hours — check the webhook in Outline (Outline turns off webhooks that keep failing).";
