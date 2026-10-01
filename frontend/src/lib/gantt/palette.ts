import { PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import type { Priority, Section, TaskStatus } from "@/lib/queries";

// Single source of truth for Gantt bar colors. The UI applies these via
// inline styles (see GanttBar.tsx); the Excel/PDF exports read the hex
// values directly so output matches what the user sees on screen.

export const STATUS_FILL_HEX: Record<TaskStatus, string> = {
  TODO: "#94a3b8",        // slate-400 — visibly "not started", solid
  IN_PROGRESS: "#3b82f6", // blue-500
  DONE: "#10b981",        // emerald-500
};

export const PRIORITY_BORDER_HEX: Record<Priority, string> = {
  LOW: "#64748b",     // slate-500 — distinct from TODO-status slate-400
  MEDIUM: "#3b82f6",  // blue-500
  HIGH: "#f59e0b",    // amber-500
  URGENT: "#ef4444",  // red-500
};

export const WEEKEND_HEX = "#e2e8f0";  // slate-200, very subtle
export const HOLIDAY_HEX = "#fecaca";  // rose-200
export const TODAY_HEX = "#3aae51";    // primary green — Gantt v2 today line/pill
// Critical Path mark (plan critical-path-mark.md §3) — light-theme
// `chip-violet-text` (index.css's `:root` block). Both exporters are
// light-background-only (PDF: always; Excel: no dark-mode concept), so this
// single light value is the shared source for both, same as the hexes above.
export const CRITICAL_PATH_HEX = "#6d28d9";

// Neutral fallback for tasks/sections without a Section.color. Mirrors the
// `--phase` CSS fallback in index.css and geometry.ts's DEFAULT_SECTION_COLOR.
export const DEFAULT_SECTION_COLOR = "#94a3b8"; // slate-400

// The completed portion of a bar renders solid in its resolved Color-by
// color; the incomplete remainder renders hatched (see
// `progressHatchBackground` below, Gantt visual refresh Task 3).
// `PROGRESS_OVERLAY_ALPHA` is the exports' (exportPdf.ts) own progress
// treatment — a darker overlay (black at this opacity) anchored to the left
// edge, covering the completed portion of the bar. The live UI no longer
// uses it: exports draw their own shapes independently and are out of scope
// for the visual refresh, so this constant stays for exportPdf.ts's import
// to keep working — screen (hatch) and PDF/Excel (overlay) now render
// progress with two different treatments, an accepted divergence for T3.
export const PROGRESS_OVERLAY_ALPHA = 0.28;

// ---- Bar hatch treatment (Gantt visual refresh, Task 3) ----
// The live bar's INCOMPLETE portion (progress% to 100%) renders as a 135°
// diagonal repeating stripe of the bar's own color — same technique as the
// engine's off-day hatch (reui/gantt/gantt-view.tsx's `offDayBodyClassName`:
// `repeating-linear-gradient(135deg, transparent, transparent 5px,
// color-mix(...) 5px, color-mix(...) 6px)`), just parameterized on an
// arbitrary resolved hex instead of a fixed design token, since a bar's
// fill varies by colorBy mode (status/section/priority — see `barFillHex`
// below) and only resolves to a hex at render time.
//
// The stripe alternates a dimmed base band (the incomplete portion reading
// as a *washed-out* version of the bar color) with a near-full-opacity
// stripe band (reading as the bar color itself) — "the bar color over a
// dimmed base," not two unrelated colors. The completed portion (rendered
// solid, full alpha, in SolvroBar.tsx) sits at HATCH_STRIPE_ALPHA-or-above,
// so the done/hatch boundary doesn't read as a big luminance jump.
const HATCH_ANGLE_DEG = 135;
const HATCH_BAND_PX = 4; // width of each alternating band, 8px full repeat
export const HATCH_BASE_ALPHA = 0.35;
export const HATCH_STRIPE_ALPHA = 0.9;

/**
 * Parses a 6-digit `#rrggbb` hex into 0-255 channel values. Same "always
 * 6-digit hex" assumption SolvroBar.tsx's own `hexLuminance` already makes —
 * every color this file resolves (STATUS_FILL_HEX, PRIORITY_BORDER_HEX,
 * section colors, DEFAULT_SECTION_COLOR) is 6-digit hex.
 */
function hexToRgbChannels(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

/** `#rrggbb` + alpha (0-1) -> `rgba(r, g, b, a)`. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Diagonal hatch `background-image` for a bar's incomplete portion — see the
 * file-level comment above. Consumed by SolvroBar.tsx as an inline style
 * (the resolved hex isn't a design token, so this can't be a Tailwind class).
 * BOTH gradient bands are translucent rgba — this alone paints nothing
 * opaque, so it must always be layered over an opaque base, specifically the
 * theme's plain `background` canvas hex (`HATCH_CANVAS_HEX_DARK`/`_LIGHT`
 * below) — NOT `hatchCompositeHex`'s output, which already has some of
 * `hex` blended in and would double-count it (see that function's own doc
 * for the T3 phase-review fix this refers to). Without an opaque base of
 * SOME kind underneath, the row's grid lines / weekend hatch / today wash
 * read straight through.
 */
export function progressHatchBackground(hex: string): string {
  const base = hexToRgba(hex, HATCH_BASE_ALPHA);
  const stripe = hexToRgba(hex, HATCH_STRIPE_ALPHA);
  const bandEnd = HATCH_BAND_PX;
  const repeatEnd = HATCH_BAND_PX * 2;
  return `repeating-linear-gradient(${HATCH_ANGLE_DEG}deg, ${base} 0px, ${base} ${bandEnd}px, ${stripe} ${bandEnd}px, ${stripe} ${repeatEnd}px)`;
}

// Reference canvases for `hatchCompositeHex` below — the `background` token
// per theme (DESIGN.md §1 / index.css's `--background`). SolvroBar.tsx is
// responsible for resolving the live theme (`useTheme()`) and passing the
// matching one in — this module has no theme context of its own, and
// picking the wrong canvas here would compute a composite that doesn't
// match what the hatch layer actually paints in that theme (see the T3
// phase-review fix below).
export const HATCH_CANVAS_HEX_DARK = "#1a1a18";
export const HATCH_CANVAS_HEX_LIGHT = "#f9f9f7";

// Perceived average opacity of the two alternating hatch bands — used to
// build ONE opaque stand-in color for (a) the hatch layer's own backdrop
// and (b) the inside-label text-color decision when the label sits over a
// fully-hatched bar. Equal-width bands (HATCH_BAND_PX each), so a flat mean.
const HATCH_MEAN_ALPHA = (HATCH_BASE_ALPHA + HATCH_STRIPE_ALPHA) / 2;

function compositeChannel(fg: number, bg: number, alpha: number): number {
  return Math.round(fg * alpha + bg * (1 - alpha));
}

function toHexByte(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * Opaque stand-in for "the bar color as it actually reads through the
 * hatch" — an alpha composite of `hex` at HATCH_MEAN_ALPHA over the CALLER-
 * SUPPLIED `canvasHex` (one of the two constants above, chosen by the live
 * theme). Two consumers in SolvroBar.tsx, and both MUST share the same
 * `canvasHex` for a given render or the two diverge (T3 phase-review fix —
 * see below):
 *   (a) the label-color decision when the visible label sits entirely over
 *       the hatch (progress-0 bars, i.e. `doneWidth === 0` — per
 *       geometry.ts's `progressForTask`, every non-DONE leaf task has
 *       progress 0, so this is the common case, not an edge case). The pure
 *       bar hex reads meaningfully lighter than the actual painted
 *       composite, enough to flip the 0.6 luminance threshold for some
 *       palette colors (e.g. TODO-status slate, HIGH-priority amber) and
 *       land dark text on a dark background.
 *   (b) NOT the hatch layer's own `backgroundColor` — that must stay the
 *       raw `canvasHex` itself (opaque, unblended). `progressHatchBackground`
 *       already paints two `hex`-at-alpha bands on top of it; painting THIS
 *       composite underneath as well would double-count `hex` (composite
 *       already contains hex-at-0.625, then the bands add more hex-at-alpha
 *       on top of that), pushing the mean painted alpha to ~0.86 instead of
 *       the intended 0.625 — silently making 0%-progress bars read nearly
 *       solid instead of visibly hatched, and breaking (a)'s model in the
 *       same stroke since the label decision no longer matches what's
 *       painted. `hatchCompositeHex`'s OWN math (`hex` at HATCH_MEAN_ALPHA
 *       over `canvasHex`) is exactly what raw-canvas-plus-two-bands paints
 *       out to on average — that's what keeps (a) truthful.
 */
export function hatchCompositeHex(hex: string, canvasHex: string): string {
  const [fr, fg, fb] = hexToRgbChannels(hex);
  const [br, bg, bb] = hexToRgbChannels(canvasHex);
  const r = compositeChannel(fr, br, HATCH_MEAN_ALPHA);
  const g = compositeChannel(fg, bg, HATCH_MEAN_ALPHA);
  const b = compositeChannel(fb, bb, HATCH_MEAN_ALPHA);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

export type ColorByMode = "status" | "section" | "priority";

// Single fill-COLOR resolver for live bars AND both exports — keeps the
// resolved hex in agreement across screen and generated documents whichever
// colorBy mode is active. (The PROGRESS treatment built on top of that hex
// diverges between the live UI's hatch and the exports' overlay — see
// PROGRESS_OVERLAY_ALPHA above; this resolver itself is unaffected.)
// TaskStatus and Priority are already imported at the top of this file, and
// the two Records are strictly keyed — hence the enum-typed opts (not string).
export function barFillHex(
  opts: {
    status?: TaskStatus | null;
    priority?: Priority | null;
    sectionColor?: string | null;
  },
  mode: ColorByMode,
): string {
  if (mode === "status") return STATUS_FILL_HEX[opts.status ?? "TODO"];
  if (mode === "priority") return PRIORITY_BORDER_HEX[opts.priority ?? "MEDIUM"];
  return opts.sectionColor ?? DEFAULT_SECTION_COLOR;
}

// Preset swatches for the section color picker (Task 6). Vivid, dark+light-safe
// set. Deliberately omits slate `#94a3b8`: that hex stays the Section.color
// schema default (backend untouched) and is treated as the "never customized"
// sentinel — geometry.ts's fallback resolution keys on it to assign one of
// these presets deterministically. Excluding it from the picker means an
// explicit user pick can never collide with the sentinel. Order matters: it
// is also the fallback cycling order.
export const SECTION_COLOR_PRESETS = [
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#d946ef", // fuchsia
] as const;

// Single resolution point for section colors, shared by geometry.ts's
// buildRows and the toolbar legend so the two can never disagree. Sections
// whose stored color is missing or still the schema-default slate sentinel
// (#94a3b8) have never been through the color picker and get a vivid preset
// assigned deterministically by (position, id) order; explicit picks always
// win — the sentinel is excluded from SECTION_COLOR_PRESETS so a user pick
// can never collide with it.
export function resolveSectionColors(
  sections: ReadonlyArray<Pick<Section, "id" | "position" | "color">>,
): Map<number, string> {
  const sorted = [...sections].sort((a, b) => a.position - b.position || a.id - b.id);
  const map = new Map<number, string>();
  sorted.forEach((s, index) => {
    const stored = s.color?.trim();
    const isUnset = !stored || stored.toLowerCase() === DEFAULT_SECTION_COLOR.toLowerCase();
    map.set(
      s.id,
      isUnset ? SECTION_COLOR_PRESETS[index % SECTION_COLOR_PRESETS.length] : stored,
    );
  });
  return map;
}

export function legendEntries(
  mode: ColorByMode,
  sections: ReadonlyArray<Pick<Section, "id" | "name" | "position" | "color">> = [],
): Array<[string, string]> {
  if (mode === "status") {
    return [
      [TASK_STATUS_LABEL.TODO, STATUS_FILL_HEX.TODO],
      [TASK_STATUS_LABEL.IN_PROGRESS, STATUS_FILL_HEX.IN_PROGRESS],
      [TASK_STATUS_LABEL.DONE, STATUS_FILL_HEX.DONE],
    ];
  }
  if (mode === "priority") {
    return [
      [PRIORITY_LABEL.LOW, PRIORITY_BORDER_HEX.LOW],
      [PRIORITY_LABEL.MEDIUM, PRIORITY_BORDER_HEX.MEDIUM],
      [PRIORITY_LABEL.HIGH, PRIORITY_BORDER_HEX.HIGH],
      [PRIORITY_LABEL.URGENT, PRIORITY_BORDER_HEX.URGENT],
    ];
  }
  // Section mode: one entry per section in board order, resolved through the
  // same fallback cycling the bars use.
  const colors = resolveSectionColors(sections);
  return [...sections]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((s): [string, string] => [s.name, colors.get(s.id) ?? DEFAULT_SECTION_COLOR]);
}
