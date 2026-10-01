import { useLayoutEffect, useRef, useState } from "react";
import type { GanttRenderEventProps } from "@/components/reui/gantt/gantt";
import {
  DEFAULT_SECTION_COLOR,
  HATCH_CANVAS_HEX_DARK,
  HATCH_CANVAS_HEX_LIGHT,
  hatchCompositeHex,
  progressHatchBackground,
} from "@/lib/gantt/palette";
import type { Task } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Solvro's `renderEvent` content renderer for the ReUI-engined Gantt (Plan B
// Task 4). Wired in via SolvroGantt.tsx's `<Gantt renderEvent={(p) =>
// <SolvroBar {...p} />} classNames={{ event: "overflow-visible bg-transparent
// hover:bg-transparent data-selected:bg-transparent" }} barLabel="inside">`.
//
// gantt-bar.tsx hands the bar's WRAPPER (position, drag/resize, a11y, selection,
// tooltip) to the engine and only the INNER content to us (gantt-bar.tsx:100-104,
// 186-194) — setting `renderEvent` makes the bar "consumer-owned," so the
// built-in 20%-opacity fill/progress tint/done-mark are suppressed or made
// irrelevant and this component owns 100% of what a bar looks like.
//
// `classNames.event` neutralizes the built-in `bg-(--gantt-event-color)/20`
// track (base + hover + selected variants — three separate conflict groups
// in tailwind-merge, all three must be overridden or the ghost look flashes
// back on hover/select) AND flips the bar's `overflow-hidden` to
// `overflow-visible`. That second part is what makes the "outside label"
// below possible at all: renderEvent's return value nests INSIDE the bar
// button (gantt-bar.tsx's `children: (<>{progress}{content}{resize}</>)`),
// so without `overflow-visible` nothing we render could ever escape the
// button's box to sit visually beside it.

// ---- GH #58: label placement is a real measurement, not a width guess ----
// ReUI's own `barLabel="auto"` flip (constant at gantt-view.tsx:202,
// AUTO_LABEL_MIN_REM = 7; the comparison itself at gantt-view.tsx:3210-3216)
// compares the bar's RENDERED WIDTH against a flat rem threshold — never the
// title text itself. A short bar with a short title can flip outside just as
// easily as a long bar with a long title stays inside and gets clipped.
// That's the "width-threshold, not measured-fit" case task-4-brief.md
// predicted, confirmed by reading the source rather than guessing.
//
// This component doesn't use ReUI's flip at all. SolvroGantt.tsx passes
// `barLabel="inside"` (already the engine default, made explicit) so
// gantt-view.tsx's row never computes its own outside placement or renders
// its own outside `<span>` sibling — that whole mechanism is disabled/
// replaced, not tuned. Placement is decided here, 100%, every render.
//
// The old engine (frontend/src/components/gantt/GanttBar.tsx:34-74) measured
// fit with an offscreen canvas (measureText + a hardcoded font string + a
// width cache) because it was handed the bar's pixel width directly as
// explicit geometry. ReUI's renderEvent gets no such number — `occurrence`/
// `segment` carry dates, not pixels — so this version measures the real
// rendered DOM instead: an invisible `nowrap` measurer span reports the
// title's true rendered width (immune to the old approach's font-string/
// sub-pixel-drift risk, since it IS the actual node in the actual font),
// and a ResizeObserver on the content row reports the actual available
// width as it changes across zoom/scale/tree-panel-resize. Whichever is
// bigger decides fit — no font string, no cache, no guessed threshold.
const INSIDE_LABEL_PADDING_PX = 12; // slack, same semantics as the old constant of the same name
const OUTSIDE_LABEL_MAX_WIDTH = 240; // px — matches the old engine's OUTSIDE_LABEL_MAX_WIDTH

// Standard relative-luminance approximation, ported verbatim from
// GanttBar.tsx:56-74 — decides whether a bar's resolved fill needs light or
// dark label text to stay readable.
const LABEL_LUMINANCE_THRESHOLD = 0.6;

function hexLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function insideLabelTextColor(hex: string): string {
  return hexLuminance(hex) > LABEL_LUMINANCE_THRESHOLD ? "rgba(0, 0, 0, 0.75)" : "#ffffff";
}

/**
 * Measures whether `title`, rendered at the label's real font/size, fits the
 * live width of the returned `containerRef` box (minus slack). Re-checks on
 * container resize (zoom/scale/tree-panel changes), on title change, and
 * once webfonts finish loading — "Source Sans 3" is not guaranteed
 * synchronously available on first paint. Safe to call unconditionally
 * (Rules of Hooks) even for bar kinds that never attach the refs — the
 * effect just no-ops when there's nothing mounted to measure.
 */
function useLabelFits(title: string) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const check = () => {
      setFits(measure.scrollWidth + INSIDE_LABEL_PADDING_PX <= container.clientWidth);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(container);
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) check();
    });
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [title]);

  return { containerRef, measureRef, fits };
}

const LABEL_TEXT_CLASSNAME = "truncate text-meta font-medium leading-none";

// Plan B Task 6 — connect dots. Visual spec adapted from the old engine
// (frontend/src/components/gantt/GanttBar.tsx:424-441,463-494): a 12px
// white-bordered primary circle, hidden until the bar is hovered,
// `cursor-crosshair`. `group-hover/gantt-bar-group` is the SAME hover group
// gantt-bar.tsx's own resize handles react to (gantt-bar.tsx:226,242), so
// dots and resize handles fade in together.
//
// Positioning — deliberately NOT centered on the edge (fix pass, post-
// review): gantt-bar.tsx's resize handle occupies `start-0.5 w-2` /
// `end-0.5 w-2` — i.e. [2px, 10px] measured INWARD from each edge
// (gantt-bar.tsx:226,242). A dot centered on the edge line (old engine's own
// `transform: translate(-50%, -50%)` convention) would span [-6px, +6px]
// from that same edge — a [2px, 6px] overlap with the handle where, being
// later in paint order, the dot wins every pointerdown and the resize
// handle becomes ungrabbable in that band (worse on touch, no hover cue).
// Fixed by pushing each dot fully OUTSIDE the bar instead, with a 4px gap
// (same gap constant the old engine's MILESTONE dots used, GanttBar.tsx:329:
// `cx - half - 4`): left dot spans [-16px, -4px] from the bar's left edge
// (`start-0` + `-translate-x-[16px]`, i.e. the dot's own 12px box shifted
// 16px outward), right dot spans [+4px, +16px] from the right edge
// (mirrored). Both spans are entirely negative/positive relative to the
// handle's [2px, 10px] INWARD span — zero overlap, verified by inspection:
// dot ranges never intersect [2, 10] because they don't cross 0 at all.
//
// The dot itself carries NO drag logic — `GanttOverlay.tsx` owns the entire
// drag-create lifecycle via a document-level CAPTURE-phase pointerdown
// listener keyed on `[data-connect-dot]` (capture fires before this bubble
// handler, so it always sees the press even though this handler goes on to
// stopPropagation()). The dot's only job here is that stopPropagation — it
// stops the press from *also* reaching gantt-bar.tsx's own onPointerDown
// (`gestures.beginMove`), which would otherwise start a bar-move drag on the
// same gesture. Sitting outside the bar doesn't change that — the dot is
// still a descendant of the button, so the press still bubbles into it.
function ConnectDots() {
  return (
    <>
      <span
        data-connect-dot
        data-connect-side="left"
        aria-hidden
        title="Drag from another task to make this task depend on it"
        // SOLVRO PATCH (shadow-style unification tail) — DESIGN.md §4: no
        // shadows outside overlays. Dropped `shadow-xs`.
        className="border-white bg-primary absolute top-1/2 start-0 z-10 size-3 -translate-x-[16px] -translate-y-1/2 cursor-crosshair rounded-full border-2 opacity-0 transition-opacity group-hover/gantt-bar-group:opacity-100 pointer-coarse:opacity-100"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      />
      <span
        data-connect-dot
        data-connect-side="right"
        aria-hidden
        title="Drag to a task to create a dependency"
        // SOLVRO PATCH (shadow-style unification tail) — DESIGN.md §4: no
        // shadows outside overlays. Dropped `shadow-xs`.
        className="border-white bg-primary absolute top-1/2 end-0 z-10 size-3 translate-x-[16px] -translate-y-1/2 cursor-crosshair rounded-full border-2 opacity-0 transition-opacity group-hover/gantt-bar-group:opacity-100 pointer-coarse:opacity-100"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      />
    </>
  );
}

export interface SolvroBarProps extends GanttRenderEventProps<Task> {
  /** Gates connect-dot rendering — read-only users get no drag-create affordance. */
  canEdit: boolean;
}

/** Solvro's bar content — see the file-level comment for the full picture. */
export function SolvroBar({ occurrence, segment, isSelected, canEdit }: SolvroBarProps) {
  const event = occurrence.event;
  const title = event.title;
  // Hooks called unconditionally, before any branch/early-return, so every
  // bar kind (rollup included) keeps a stable hook order across re-renders.
  const { containerRef, measureRef, fits } = useLabelFits(title);
  // Resolved theme drives which canvas hex the hatch composite blends
  // against (T3 phase-review fix — see `canvasHex` below); only the regular
  // task-bar path below actually reads it, but Rules of Hooks still requires
  // this above the rollup/milestone early-returns.
  const { resolved: resolvedTheme } = useTheme();

  // Section rollup (point 6): synthetic events from buildRollupEvents carry
  // no `data` — the id prefix is the only signal, and is also what e2e specs
  // and this component agree on instead of a shared type guard.
  //
  // Gantt visual refresh Task 3: restyled from a full-width rounded pill to
  // a thin summary bar with squared end caps (reference style) — a short
  // vertical cap at each end joined by a thinner horizontal line through
  // the middle. All three pieces share the section's resolved color via the
  // engine's `--gantt-event-color` var (set on the bar wrapper,
  // gantt-bar.tsx:275) — no local hex needed here, same as the pill this
  // replaces.
  //
  // T3 fix round: `absolute inset-0` (not a statically-sized block) so the
  // caps sit at the bar's TRUE edges — the button's own content box is
  // padded (`px-1.5 py-0.5`, gantt-bar.tsx:292), and a merely `relative`
  // block confined to that padded box put the caps 6px inside the section's
  // real date range. Same escape trick the task-bar fill below already uses
  // (see its comment). `min-w-2` (8px) guards a 1-day section at a coarse
  // zoom, where the bar's rendered width can fall below the two 3px caps'
  // combined width — without a floor they'd visually meet or overlap. Where
  // the true width is already narrower than that floor, the browser resolves
  // the over-constrained inset by extending the wrapper past the right edge
  // (small, and only at zoom levels too coarse to show a 1-day bar legibly
  // anyway) rather than shrinking a cap into the other.
  if (event.id.startsWith("section-rollup-")) {
    return (
      <span
        data-rollup
        aria-hidden
        className="pointer-events-none absolute inset-0 min-w-2"
      >
        <span className="absolute inset-y-0 start-0 w-[3px] bg-(--gantt-event-color)" />
        <span className="absolute inset-y-0 end-0 w-[3px] bg-(--gantt-event-color)" />
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-(--gantt-event-color)" />
      </span>
    );
  }

  const task = event.data;
  if (!task) return null;

  // Rollups are excluded above; every remaining event here is `readOnly:
  // !canEdit` (adapter.ts's taskToEvent), so this is currently equivalent to
  // just `canEdit` — checked explicitly anyway in case a future per-task
  // readOnly override diverges from the global flag.
  const showConnectDots = canEdit && !event.readOnly;

  const color = event.color ?? DEFAULT_SECTION_COLOR;

  const rawProgress = typeof event.progress === "number" ? event.progress : null;
  // Absent progress data (every milestone — the only event kind here whose
  // `progress` is legitimately non-numeric, adapter.ts's taskToEvent) renders
  // fully solid: doneWidth 100 means the milestone branch below, which never
  // reads doneWidth/showHatch, stays exactly as before.
  const doneWidth =
    rawProgress === null ? 100 : Math.min(Math.max(Math.round(rawProgress), 0), 100);
  const showHatch = doneWidth < 100;

  // T3 phase-review fix: the hatch layer paints its two translucent bands
  // (see the `backdrop` JSX below) directly over the theme's plain canvas
  // hex — NOT over `hatchCompositeHex`'s output, which would double-count
  // `color` (see that function's own doc). `canvasHex` is what both the
  // paint and the label decision below key off of, so they describe the
  // same physical surface in whichever theme is active.
  const canvasHex = resolvedTheme === "dark" ? HATCH_CANVAS_HEX_DARK : HATCH_CANVAS_HEX_LIGHT;

  // When the visible label sits entirely over the hatch (doneWidth === 0 —
  // per geometry.ts's `progressForTask`, every non-DONE leaf task has
  // progress 0, so this is the common case, not an edge case), the label's
  // actual painted background is `hatchCompositeHex(color, canvasHex)`, not
  // the pure bar hex — the two gradient bands average out lighter or darker
  // than the pure hex depending on the theme's canvas, enough to flip the
  // 0.6 luminance threshold for some palette colors (e.g. TODO-status
  // slate, HIGH-priority amber) and land unreadable text on the hatch.
  const labelBackgroundHex = doneWidth === 0 ? hatchCompositeHex(color, canvasHex) : color;
  const textColor = insideLabelTextColor(labelBackgroundHex);

  // Selection affordance uses `outline` rather than `ring` so it can coexist
  // with any future ring-based decoration without the two fighting over the
  // same tailwind-merge conflict group (outline is a separate CSS
  // property/utility group entirely).
  const selectedOutline = isSelected && "outline outline-2 outline-offset-1 outline-on-surface/70";

  if (task.isMilestone) {
    return (
      <span
        data-task-id={task.id}
        data-milestone
        // Critical Path DOM contract (plan §3): present only when marked,
        // absent (not "false") otherwise — e2e selects on the attribute's
        // mere presence.
        data-critical-path={task.isCriticalPath || undefined}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-sm",
          selectedOutline,
        )}
      >
        {/* Primary green, not `--gantt-event-color` — parity with the old
            engine (GanttBar.tsx:318-320), which hardcodes the milestone
            diamond to primary with an explicit "not section color" comment.
            The brief's skeleton using the event color was the error; this
            reverts to shipped behavior across all colorBy modes (Plan B
            Task 4 review finding). */}
        <span
          aria-hidden
          className={cn(
            "bg-primary inline-block size-2.5 shrink-0 rotate-45",
            // Critical Path mark (plan §3): an outline (not the wrapper's
            // selection `outline`, which stays untouched) rotates with the
            // `rotate-45` box, so it reads as a diamond-shaped ring around
            // the filled diamond. `me-1` (review fix round): the wrapper's
            // `gap-1.5` alone left the ring's outer edge — 3px past the box
            // from the 2px outline + 1px offset — almost touching the
            // title; the extra margin restores clearance without widening
            // the gap for the unmarked (common) case.
            task.isCriticalPath &&
              "me-1 outline outline-2 outline-offset-1 outline-chip-violet-text",
          )}
        />
        {/* Decorative — the button's own aria-label (gantt-bar.tsx) already
            announces the title, so this visual duplicate stays out of the a11y tree. */}
        <span aria-hidden className={LABEL_TEXT_CLASSNAME} style={{ color: textColor }}>
          {title}
        </span>
        {/* Milestones have connector dots too — parity with the old engine's
            GanttBar.tsx milestone branch (:323-354), which rendered its own
            pair alongside the diamond. */}
        {showConnectDots && <ConnectDots />}
      </span>
    );
  }

  // Fill: rendered by us (not classNames.event) so it can stay OFF for
  // rollup/milestone bars while still being the full-bleed backdrop for
  // regular bars. `inset-0` anchors to the button (the nearest positioned
  // ancestor — our own wrapper below is deliberately left non-positioned so
  // this reaches the button's true edges, padding included, rather than
  // stopping at our wrapper's inset content box). Rounding mirrors the
  // button's own continues-before/after squaring (gantt-bar.tsx's
  // `segment.continuesBefore/After` classes) so a bar split across the
  // visible range's edge doesn't show mismatched corners between the
  // button's shape and our backdrop's.
  //
  // Gantt visual refresh Task 3: inverted from a solid backdrop + a flat
  // black overlay covering the COMPLETED portion, to a diagonal hatch of the
  // bar color as the base with a solid fill laid over its [0, doneWidth%)
  // head — the reference treatment. The outer span owns rounding/selection-
  // outline/hover-brightness exactly as the old single backdrop did
  // (`overflow-hidden` clips both inner fills to that same rounded shape).
  //
  // T3 fix round (nit): the hatch paints FULL-BLEED (`inset-0`, no width
  // math) instead of being sized to exactly [doneWidth%, 100%] — the solid
  // head simply paints over whatever hatch is underneath it. Two
  // independently-computed percentage widths that are supposed to sum to
  // exactly 100% can round to adjacent device pixels differently and leave
  // a hairline gap or overlap at the seam; painting the hatch everywhere
  // and letting the solid head cover it removes that failure mode entirely
  // (`showHatch` now only skips rendering it at all for DONE bars, where
  // the solid head already covers 100% and the hatch would be invisible).
  //
  // T3 fix round (should-fix): `progressHatchBackground`'s two gradient
  // bands are both translucent rgba, so the hatch layer also carries an
  // opaque `backgroundColor` underneath the gradient — without it, the
  // row's grid lines / weekend hatch / today wash would paint straight
  // through the hatch's "gaps."
  //
  // T3 phase-review fix: that opaque backing is `canvasHex` (the theme's
  // plain background token), NOT `hatchCompositeHex(color, canvasHex)`. The
  // composite already has `color` blended into it at HATCH_MEAN_ALPHA;
  // painting the gradient's `color`-at-alpha bands on top of THAT would
  // double-count `color` (mean painted alpha ends up ~0.86, not the
  // intended 0.625) and silently desync the label's contrast decision above
  // from what's actually on screen — see `hatchCompositeHex`'s doc in
  // palette.ts for the full arithmetic. The raw canvas is what the
  // composite math (and the label decision built on it) actually models.
  const backdrop = (
    <span
      aria-hidden
      data-slot="solvro-bar-fill"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        "group-hover/gantt-bar-group:brightness-110",
        segment.continuesBefore ? "rounded-s-none" : "rounded-s-sm",
        segment.continuesAfter ? "rounded-e-none" : "rounded-e-sm",
        selectedOutline,
      )}
    >
      {showHatch && (
        <span
          aria-hidden
          data-slot="solvro-bar-hatch"
          className="absolute inset-0"
          style={{
            backgroundColor: canvasHex,
            backgroundImage: progressHatchBackground(color),
          }}
        />
      )}
      <span
        aria-hidden
        className="absolute inset-y-0 start-0"
        style={{ width: `${doneWidth}%`, backgroundColor: color }}
      />
      {/* Critical Path mark (plan §3): a violet inset ring, painted LAST
          (after the hatch and the progress fill) so it sits above both.
          `ring`, not `outline` — `selectedOutline` above already claims
          `outline` for the selection affordance, and the two live in
          separate tailwind-merge conflict groups so they never fight. */}
      {task.isCriticalPath && (
        <span
          aria-hidden
          data-slot="solvro-bar-critical"
          className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-chip-violet-text"
        />
      )}
    </span>
  );

  return (
    <span
      ref={containerRef}
      data-task-id={task.id}
      // Critical Path DOM contract (plan §3): present only when marked,
      // absent (not "false") otherwise — e2e selects on the attribute's
      // mere presence. Section rollups never reach this branch (they
      // return early above), so they never carry it.
      data-critical-path={task.isCriticalPath || undefined}
      data-label-outside={!fits || undefined}
      className="flex h-full min-w-0 flex-1 items-center"
    >
      {backdrop}
      {/* Invisible measurer: same font/size as the real label, never
          truncated, removed from flow so it never affects layout — its
          scrollWidth is the title's true rendered width (see useLabelFits). */}
      <span
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute whitespace-nowrap text-meta font-medium"
      >
        {title}
      </span>
      {fits ? (
        // Decorative — see the milestone branch's identical note: the
        // button's own aria-label already carries the title.
        <span
          aria-hidden
          className={cn("relative min-w-0 px-0.5", LABEL_TEXT_CLASSNAME)}
          style={{ color: textColor }}
        >
          {title}
        </span>
      ) : (
        <span
          aria-hidden
          data-slot="solvro-bar-label-outside"
          className="text-on-surface pointer-events-none absolute start-full top-1/2 z-10 ms-1.5 flex -translate-y-1/2 items-center gap-1"
          style={{ maxWidth: OUTSIDE_LABEL_MAX_WIDTH }}
        >
          <span
            aria-hidden
            className="h-[3px] w-[3px] shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className={LABEL_TEXT_CLASSNAME}>{title}</span>
        </span>
      )}
      {showConnectDots && <ConnectDots />}
    </span>
  );
}
