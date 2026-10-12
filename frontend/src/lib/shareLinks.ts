// Pure helpers for guest links (docs/archive/plans/collaboration-and-sharing.md,
// L4): the owner's link list and the public guest timeline. No React, no I/O.
import { ApiError } from "@/lib/api";
import { dayFromIso } from "@/lib/dateField";
import type { PublicPhaseStatus, ShareLink } from "@/lib/queries";

export const SHARE_LABEL_MAX = 80;

/** Expiry choices in the create form; 30 days is the default. */
export const SHARE_EXPIRY_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;

export type ShareLinkStatus = "active" | "expired" | "revoked";

/** Revoked beats expired: a link someone turned off reads "Revoked" forever. */
export function shareLinkStatus(
  link: Pick<ShareLink, "expiresAt" | "revokedAt">,
  now: Date = new Date(),
): ShareLinkStatus {
  if (link.revokedAt) return "revoked";
  const expires = new Date(link.expiresAt).getTime();
  if (Number.isFinite(expires) && expires <= now.getTime()) return "expired";
  return "active";
}

/** The label to show for a link; unlabelled links read "Untitled link". */
export function shareLinkTitle(link: Pick<ShareLink, "label">): string {
  const label = link.label?.trim();
  return label ? label : "Untitled link";
}

/**
 * The server returns `/share/<token>` (or, defensively, a full URL). Anything
 * relative is prefixed with the page's origin so the copied link works when
 * pasted elsewhere.
 */
export function absoluteShareUrl(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = origin.replace(/\/+$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Trimmed label, or undefined when empty (the server treats it as optional). */
export function normalizeShareLabel(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, SHARE_LABEL_MAX) : undefined;
}

// --- Public guest timeline ---------------------------------------------------

export type PhaseTone = "emerald" | "blue" | "gray";

export const PHASE_STATUS_TONE: Record<PublicPhaseStatus, PhaseTone> = {
  done: "emerald",
  in_progress: "blue",
  not_started: "gray",
};

/** Unknown server values degrade to "Not started" instead of rendering blank. */
export function phaseStatusOf(v: unknown): PublicPhaseStatus {
  return v === "done" || v === "in_progress" ? v : "not_started";
}

const DAY_MS = 86_400_000;

function dayNumber(v: string | null | undefined): number | null {
  const day = dayFromIso(v ?? null);
  if (!day) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.round(t / DAY_MS);
}

export interface PhaseBar {
  /** Percent from the left edge of the overall range. */
  left: number;
  /** Percent of the overall range; never below `MIN_BAR_PERCENT`. */
  width: number;
}

export interface TimelineLayout {
  /** Overall range as calendar days, or null when no phase has a date. */
  range: { start: string; end: string } | null;
  /** One entry per input phase, null for a phase with no dates at all. */
  bars: (PhaseBar | null)[];
  /** Position of today within the range (0-100), or null when outside it. */
  today: number | null;
}

/** Keeps a one-day (or single-date) phase visible. */
export const MIN_BAR_PERCENT = 2;

function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Positions phases as bars across the overall date range. A phase with only one
 * date collapses to that day; a phase with none gets no bar. The range is
 * inclusive of the last day (a phase ending on day N covers all of day N), so a
 * single-day range still has width.
 */
export function timelineLayout(
  phases: readonly { startDate: string | null; endDate: string | null }[],
  todayDay: string | null = null,
): TimelineLayout {
  const spans = phases.map((p) => {
    const a = dayNumber(p.startDate);
    const b = dayNumber(p.endDate);
    if (a === null && b === null) return null;
    const start = a ?? (b as number);
    const end = b ?? (a as number);
    return start <= end ? { start, end } : { start: end, end: start };
  });
  const known = spans.filter((s): s is { start: number; end: number } => s !== null);
  if (known.length === 0) return { range: null, bars: spans.map(() => null), today: null };

  const min = Math.min(...known.map((s) => s.start));
  const max = Math.max(...known.map((s) => s.end));
  const total = max - min + 1;

  const bars = spans.map((s) => {
    if (!s) return null;
    const left = ((s.start - min) / total) * 100;
    const width = Math.max(((s.end - s.start + 1) / total) * 100, MIN_BAR_PERCENT);
    // A minimum-width bar near the right edge must not spill out of the track.
    return { left: Math.min(left, 100 - width), width };
  });

  const t = dayNumber(todayDay);
  const today = t !== null && t >= min && t <= max ? ((t - min + 0.5) / total) * 100 : null;
  return { range: { start: dayString(min), end: dayString(max) }, bars, today };
}

export interface GuestErrorCopy {
  icon: string;
  title: string;
  hint: string;
  /** Expired, revoked or unknown: nothing to retry. */
  final: boolean;
}

/** What a guest sees when the public payload could not be loaded (full page and embed alike). */
export function guestErrorCopy(error: unknown): GuestErrorCopy {
  const status = error instanceof ApiError ? error.status : null;
  if (status === 429) {
    return {
      icon: "hourglass_top",
      title: "Too many requests — try again in a minute",
      hint: "You have opened this page too many times in a short while.",
      final: false,
    };
  }
  if (status === 404) {
    return {
      icon: "link_off",
      title: "This link has expired or is no longer available",
      hint: "Ask the person who shared it with you for a new link.",
      final: true,
    };
  }
  return {
    icon: "error",
    title: "Something went wrong",
    hint: "The project could not be loaded. Check your connection and try again.",
    final: false,
  };
}
