// Pure path math for dependency connectors, ported VERBATIM from
// `frontend/src/components/gantt/GanttConnectors.tsx` (Plan B Task 6). The
// old engine derived bar edges analytically from Row/chartStart/viewMode/
// columnWidth; the new engine measures real DOM rects instead (GanttOverlay's
// `measureBars`), so every geometry-type param here is a plain rect
// `{x, y, width, height}` rather than a `Row`. The trig/branching logic
// itself — polyline construction, arc-length trim, forward-vs-back-route
// choice — is unchanged.
//
// No React here on purpose: this module is pure so it can be unit-tested (or
// at minimum hand-traced) independent of any DOM/React runtime.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Pt = [number, number];

export interface ConnectorRoute {
  /** Stepped path, ready for an SVG `<path d>`. */
  d: string;
  /**
   * Same route as `d` but trimmed back from both bar edges, used for the
   * transparent pointer hit path. `null` when the connector is too short to
   * trim — the hit path then falls back to the full route.
   */
  dHit: string | null;
  /** Coords of the arrowhead tip (used by the marker). */
  tipX: number;
  tipY: number;
  /** Anchor for the × delete control — midpoint of the path's main run. */
  ax: number;
  ay: number;
}

// Ported verbatim from GanttConnectors.tsx:42-48.
export const FORWARD_NUDGE = 8; // horizontal step out from the predecessor's right edge
export const BACK_NUDGE = 8; // horizontal step into the successor's left edge
export const ARROW_INSET = 2; // pull the tip back so the arrowhead doesn't overshoot
// Arc-length trimmed off each end of the hit path. Clears the connector dot
// (~12px) at each bar edge (plus margin) so the fat hit strip can't
// intercept resize/connect pointer-downs.
export const HIT_TRIM = 14;

// Ported verbatim from GanttConnectors.tsx:52-56.
export function polylineToPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  const [h, ...rest] = pts;
  return `M ${h[0]} ${h[1]}` + rest.map((p) => ` L ${p[0]} ${p[1]}`).join("");
}

/**
 * Trim `trim` px of arc length off both ends of an axis-aligned polyline,
 * keeping interior vertices. Returns null if the polyline is too short to
 * trim from both ends (caller falls back to the untrimmed route). Ported
 * verbatim from GanttConnectors.tsx:63-93.
 */
export function trimPolyline(pts: Pt[], trim: number): Pt[] | null {
  const n = pts.length;
  if (n < 2) return null;
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
    );
  }
  const total = cum[n - 1];
  if (total <= 2 * trim + 1) return null;
  const at = (s: number): Pt => {
    let i = 1;
    while (i < n && cum[i] < s) i++;
    const segStart = cum[i - 1];
    const segEnd = cum[i];
    const t = segEnd === segStart ? 0 : (s - segStart) / (segEnd - segStart);
    return [
      pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
      pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
    ];
  };
  const a = trim;
  const b = total - trim;
  const mid: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (cum[i] > a && cum[i] < b) mid.push(pts[i]);
  }
  return [at(a), ...mid, at(b)];
}

/**
 * Stepped predecessor-right → successor-left route. Ported from the inline
 * body of `GanttConnectors.tsx`'s connector `useMemo` (lines ~164-224),
 * generalized from `Row`-derived `sx/sy/tx/ty` to plain measured rects.
 *
 * One adaptation: the old engine's back-route detour stepped by
 * `ROW_HEIGHT / 2` — a fixed constant (30px) from the old engine's static
 * row geometry. The new engine's row height is dynamic (zoom/lane-count
 * dependent), so there is no equivalent fixed constant; `succRect.height`
 * (the successor's OWN measured bar height) stands in as the analogous
 * "half a row's vertical buffer" step. Documented here and in the task
 * report rather than silently substituted.
 */
export function buildConnectorRoute(
  predRect: Rect,
  succRect: Rect,
): ConnectorRoute {
  const sx = predRect.x + predRect.width;
  const sy = predRect.y + predRect.height / 2;
  const tx = succRect.x - ARROW_INSET;
  const ty = succRect.y + succRect.height / 2;

  // If the successor is to the right of the predecessor, we route
  // forward → vertical → forward. If it's behind (or directly above),
  // route forward → up/down → backward → over → forward.
  let points: Pt[];
  let ax: number;
  let ay: number;
  if (tx >= sx + FORWARD_NUDGE) {
    const midX = Math.max(sx + FORWARD_NUDGE, tx - BACK_NUDGE);
    points = [
      [sx, sy],
      [midX, sy],
      [midX, ty],
      [tx, ty],
    ];
    // × sits on the vertical run between the two rows.
    ax = midX;
    ay = (sy + ty) / 2;
  } else {
    const out1 = sx + FORWARD_NUDGE;
    const back = tx - BACK_NUDGE;
    // Detour above/below the successor's own row band so the back-route
    // doesn't overlap the source bar (see the function-level note above).
    const detourY = ty + (ty < sy ? succRect.height / 2 : -succRect.height / 2);
    points = [
      [sx, sy],
      [out1, sy],
      [out1, detourY],
      [back, detourY],
      [back, ty],
      [tx, ty],
    ];
    // × sits on the final vertical run into the successor.
    ax = back;
    ay = (detourY + ty) / 2;
  }

  const trimmed = trimPolyline(points, HIT_TRIM);
  return {
    d: polylineToPath(points),
    dHit: trimmed ? polylineToPath(trimmed) : null,
    tipX: tx,
    tipY: ty,
    ax,
    ay,
  };
}
