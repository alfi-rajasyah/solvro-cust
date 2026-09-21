// Pure formatting helpers for the Pipeline (Solution Architect) UI — no
// React, no API calls. See PRD §2.3–§2.7 for the consuming surfaces (board
// cards, opportunity detail, KPI tiles). Currency formatting matches
// Velora's `lib/utils.ts` (../VeloraApp, read-only reference/data source
// per CLAUDE.md) verbatim so the ported UI reads identically to the
// reference app.
import { dayToDate } from "./dateField";

/**
 * Pipeline stage enum, matching `backend/prisma/schema.prisma`'s
 * `PipelineStage` — the API speaks these uppercase enum strings verbatim.
 * Defined here since this is the first Pipeline frontend module that needs
 * it; M2's hooks task (`src/lib/queries.ts`) re-exports/consumes it rather
 * than redeclaring it.
 */
export type PipelineStage =
  | "ASSESSMENT"
  | "RFP"
  | "POC"
  | "TECHNICAL_CLARIFICATION"
  | "DELIVER_PROPOSAL"
  | "WAITING_RESPONSE"
  | "WON"
  | "DROP"
  | "HOLD";

/** Display label per stage, for board columns, chips, and detail surfaces. */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  ASSESSMENT: "Assessment",
  RFP: "RFP",
  POC: "PoC",
  TECHNICAL_CLARIFICATION: "Technical Clarification",
  DELIVER_PROPOSAL: "Delivered Proposal",
  WAITING_RESPONSE: "Waiting Response",
  WON: "Won",
  DROP: "Drop",
  HOLD: "Hold",
};

/** Board column order, left to right — matches PRD §2.2/§2.3 and the
 * reference app's live schema (VeloraApp/scripts/migrate.mjs), which is
 * also the backend `PipelineStage` Prisma enum's declaration order. */
export const STAGE_ORDER: PipelineStage[] = [
  "ASSESSMENT",
  "RFP",
  "POC",
  "TECHNICAL_CLARIFICATION",
  "DELIVER_PROPOSAL",
  "WAITING_RESPONSE",
  "WON",
  "DROP",
  "HOLD",
];

/**
 * Stages that end a deal's lifecycle — no further drag/board transitions
 * expected. Single source of truth shared by board-drag gating
 * (`components/pipeline/boardLogic.ts`'s `needsTerminalConfirm`) and KPI
 * "active deal" math (`components/pipeline/kpi.ts`'s `isActiveDeal`), which
 * previously each declared their own identical copy.
 */
export const TERMINAL_STAGES: readonly PipelineStage[] = ["WON", "DROP"];

/**
 * Single source of truth for the "how far along the funnel" alpha ramp
 * every Pipeline funnel-style visualization draws on the shared `primary`
 * accent token — `PipelineKpiBar.tsx`'s `FunnelStrip`,
 * `PipelineOverviewPanel.tsx`'s `StageDistribution`, and
 * `PipelineAnalyticsSection.tsx`'s conversion-funnel chart each previously
 * hand-declared an identical copy of these same seven numbers (finding
 * N2). `DROP`/`HOLD` carry a `0` placeholder only so this Record stays
 * total over `PipelineStage` — neither stage renders via this alpha ramp at
 * all: all three call sites give DROP/HOLD their own dedicated rose/amber
 * tone instead of a `primary` alpha step, matching `StageChip`'s treatment
 * of those two stages everywhere else in the app. Tailwind-class consumers
 * (PipelineKpiBar.tsx, PipelineOverviewPanel.tsx) can't derive their class
 * strings from this at runtime — Tailwind's content scanner only detects
 * literal `bg-primary/NN` substrings, not string-interpolated ones — so
 * those two sites keep a small local `alpha -> literal class` lookup keyed
 * off these same numbers instead. This Record is the one place the
 * *numbers* themselves live.
 */
export const STAGE_ALPHA: Record<PipelineStage, number> = {
  ASSESSMENT: 0.2,
  RFP: 0.35,
  POC: 0.5,
  TECHNICAL_CLARIFICATION: 0.65,
  DELIVER_PROPOSAL: 0.8,
  WAITING_RESPONSE: 0.9,
  WON: 1,
  DROP: 0,
  HOLD: 0,
};

/**
 * Full Indonesian Rupiah rendering for detail surfaces (e.g. the opportunity
 * detail page). Matches Velora's `formatCurrency` (../VeloraApp
 * lib/utils.ts) verbatim: `Intl.NumberFormat("id-ID", { style: "currency",
 * currency: "IDR" })` with no decimals. Confirmed against this repo's own
 * Node runtime (host node v24 and the `frontend` container's node v22 both
 * agree) that this renders as "Rp 1.250.000.000" — a space after the "Rp"
 * symbol, "." as the thousands separator, no decimal places.
 */
export function formatIDR(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Compact Rupiah rendering for cards/KPIs (Pipeline board cards, dashboard
 * KPI tiles). Matches Velora's `formatCurrencyCompact` (../VeloraApp
 * lib/utils.ts) verbatim — exactly two abbreviation tiers, Indonesian
 * `jt`/`M` (not English `M`/`B`):
 *   - below 1 juta (1_000_000):  plain grouped Rupiah, e.g. "Rp 999.999"
 *   - >= 1 juta:                 "Rp {n}jt", 0 decimals, e.g. "Rp 5jt"
 *   - >= 1 miliar (1_000_000_000): "Rp {n,n}M", 1 decimal with a comma as
 *     the decimal separator (Indonesian convention), e.g. "Rp 1,3M"
 * There is no "triliun"/"T" tier — Velora's source has none. A triliun-plus
 * value (>= 1e12) falls through to the miliar tier and renders as a large
 * "M" figure (e.g. 2.5 triliun -> "Rp 2500,0M"); that is intentional, to
 * match Velora's actual behavior rather than inventing a tier it lacks.
 */
export function formatIDRCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return `Rp ${(value / 1_000_000_000).toFixed(1).replace(".", ",")}M`;
  }
  if (value >= 1_000_000) {
    return `Rp ${(value / 1_000_000).toFixed(0)}jt`;
  }
  return `Rp ${value.toLocaleString("id-ID")}`;
}

/**
 * Win-probability percentage rendering used on Pipeline cards. Velora
 * (../VeloraApp components/kanban/card.tsx) interpolates `win_probability`
 * directly (e.g. `{opportunity.win_probability}%`) since the field is
 * always stored as an integer 0-100. We round defensively so a non-integer
 * input still renders a clean whole-number percentage instead of leaking
 * decimals — a no-op for the integer values the API actually sends.
 */
export function formatWinProbability(p: number): string {
  return `${Math.round(p)}%`;
}

/**
 * Short Indonesian-locale date rendering for Pipeline surfaces (board
 * cards, List/Swimlane/Quarter views) — e.g. "30 Jun 2026". `day` is a
 * plain "yyyy-MM-dd" calendar day (`Opportunity.deadline`/`requestDate`'s
 * wire shape, see `queries.ts`'s `Opportunity` doc comment), parsed via the
 * house `dayToDate` helper (`lib/dateField.ts`) rather than `new Date(day)`
 * directly on the bare string — `new Date("yyyy-MM-dd")` parses as UTC
 * midnight, which walks back a day in any timezone west of UTC once
 * rendered with local getters; `dayToDate` parses at LOCAL midnight
 * instead, so the same calendar day one clicked in a date picker is the
 * one rendered here, in every host timezone. Callers guard the null case
 * themselves (same convention as every deadline/requestDate render site
 * already uses) — an unparsable/empty input renders as an empty string
 * rather than throwing.
 */
export function formatPipelineDate(day: string): string {
  const d = dayToDate(day);
  if (!d) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}
