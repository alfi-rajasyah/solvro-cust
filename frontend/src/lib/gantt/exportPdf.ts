import {
  addDays,
  isoWeekNumber,
  parseISODate,
  startOfDay,
  type Row,
} from "./geometry";
import {
  CRITICAL_PATH_HEX,
  HOLIDAY_HEX,
  PROGRESS_OVERLAY_ALPHA,
  WEEKEND_HEX,
  barFillHex,
  type ColorByMode,
} from "./palette";
import {
  buildConnectorRoute,
  type ConnectorRoute,
  type Rect,
} from "@/components/gantt-v2/connector-paths";
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import type { Holiday, TaskDependency } from "@/lib/queries";
import type { jsPDF as JsPDFInstance } from "jspdf";

// F4 (2026-07-25, walkthrough finding) — PDF export redesigned to match the
// ReUI-engined Gantt's on-screen visual language (SolvroBar.tsx,
// GanttOverlay.tsx, SolvroGantt.tsx's F3 axis system). Plan B Task 7
// originally froze this export layer at "re-register on the new geometry
// data, zero visual rebuild" — the user explicitly directed this redesign
// afterward, superseding that freeze (recorded in CHANGELOG.md). See
// task-f4-report.md for the full screen→PDF design-mapping table.

interface ExportPdfOpts {
  projectName: string;
  rows: Row[];
  exportStart: Date;
  exportEnd: Date;
  holidays: Holiday[];
  colorBy: ColorByMode;
  /** Dependency edges, drawn as stepped connector arrows between bars —
   *  mirrors GanttOverlay.tsx. Plan B Task 7 registered this export off
   *  Row[] alone (no dependency data reached it); F4 extends the input with
   *  the same data the live overlay already fetches (SolvroGantt.tsx's
   *  useProjectDependencies), threaded through the registration call.
   *  Optional (defaults to `[]`) so the old hand-rolled engine's own
   *  registration call (GanttFrame.tsx — untouched by this task, still
   *  live until Plan B Task 9 removes it) keeps compiling unchanged. */
  dependencies?: TaskDependency[];
  /** When set, render into this window instead of triggering a download. */
  tabWindow?: Window | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 1000 * 60 * 60 * 24;

function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60) || "project";
}

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

// ────────── Theme (light palette — the PDF stays print-appropriate light
// background regardless of the app's dark-default theme; DESIGN.md is
// binding for this). Hexes ported verbatim from index.css's `:root` block
// (the LIGHT theme values — `.dark` overrides don't apply here). ──────────
const THEME_HEX = {
  surfaceContainerLowest: "#ffffff",
  surfaceContainerLow: "#f2f2ee",
  surfaceContainer: "#ebebe7",
  onSurface: "#1a1a18",
  onSurfaceVariant: "#4a4a47",
  outline: "#9a9a97",
  outlineVariant: "#d0d0cc",
  // index.css :root --primary: 45 144 66 (light theme) — DESIGN.md's
  // Behavioral Rules table: "Primary is Elitery Green — never blue: #3aae51
  // dark / #2d9042 light." PDF is light-background, so the light value wins.
  primary: "#2d9042",
} as const;

// Ported from SolvroBar.tsx (itself ported from the old GanttBar.tsx:56-74)
// — decides whether a bar's resolved fill needs light or dark label text.
const LABEL_LUMINANCE_THRESHOLD = 0.6;

function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Inside-label text color by fill luminance — ported from SolvroBar.tsx's
 * `insideLabelTextColor`. The dark branch there is `rgba(0,0,0,0.75)`; print
 * has no backdrop texture for the alpha to matter against, so on-surface
 * (`#1a1a18`) is the direct solid stand-in.
 */
function insideLabelRgb(fillHex: string): RGB {
  return hexLuminance(fillHex) > LABEL_LUMINANCE_THRESHOLD
    ? hexToRgb(THEME_HEX.onSurface)
    : [255, 255, 255];
}

/**
 * Measured-fit text truncation — the PDF analogue of GH #58 (SolvroBar.tsx's
 * `useLabelFits`): uses the PDF's own font metrics (`pdf.getTextWidth`, at
 * whatever font/size is CURRENTLY set on `pdf` — callers must `setFont`/
 * `setFontSize` first) rather than a guessed character-count cutoff (the
 * pre-F4 version of this file used `Math.floor(width / 4)`). Binary-searches
 * the longest prefix + "…" that fits `maxWidth`.
 */
function fitText(pdf: JsPDFInstance, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  const ellipsisW = pdf.getTextWidth("…");
  if (ellipsisW > maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidateW = pdf.getTextWidth(text.slice(0, mid)) + ellipsisW;
    if (candidateW <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "…";
}

/** Diamond of half-diagonal `r` centered at (cx, cy), filled with the
 *  current fill color. jsPDF has no primitive diamond — traced as a closed
 *  3-segment path (the 4th edge is implied by `closed: true`).
 *  `mode` (Critical Path mark, plan §3 — default unchanged) selects fill
 *  ("F") vs. stroke ("S") so the same path can also draw the mark's
 *  diamond-ring outline, using whatever draw color/line width the caller
 *  already set. */
function drawDiamond(
  pdf: JsPDFInstance,
  cx: number,
  cy: number,
  r: number,
  mode: "F" | "S" = "F",
): void {
  pdf.lines(
    [
      [r, r],
      [-r, r],
      [-r, -r],
    ],
    cx,
    cy - r,
    [1, 1],
    mode,
    true,
  );
}

/** Clamps the corner radius so `roundedRect` never receives rx/ry larger
 *  than the rect itself (degenerates a near-zero-width clamped bar into a
 *  plain rect instead of a jsPDF geometry glitch).
 *  `mode` (Critical Path mark, plan §3 — default unchanged) selects fill
 *  ("F") vs. stroke ("S") so the same helper also draws the mark's ring
 *  outline around a task bar. */
function fillRoundedRect(
  pdf: JsPDFInstance,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  mode: "F" | "S" = "F",
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) {
    pdf.rect(x, y, Math.max(0, w), Math.max(0, h), mode);
  } else {
    pdf.roundedRect(x, y, w, h, rr, rr, mode);
  }
}

/** Runs `draw` with a temporary fill/stroke opacity, matching the CSS
 *  `opacity` semantics SolvroBar.tsx uses for the progress overlay (true
 *  alpha via jsPDF's GState, not a manual color blend — jsPDF v4 supports
 *  this natively). */
function withOpacity(pdf: JsPDFInstance, alpha: number, draw: () => void): void {
  pdf.setGState(pdf.GState({ opacity: alpha }));
  draw();
  pdf.setGState(pdf.GState({ opacity: 1 }));
}

/**
 * `buildConnectorRoute` (reused verbatim from
 * frontend/src/components/gantt-v2/connector-paths.ts — the same pure route
 * math GanttOverlay.tsx uses on screen) returns an SVG `<path d>` string,
 * not a point list — jsPDF draws line segments, not SVG paths. This parses
 * the "M x y L x y L x y…" format `polylineToPath` (connector-paths.ts)
 * always produces back into the points jsPDF needs.
 */
function parsePathPoints(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

/**
 * Draws one stepped connector: line segments + a small arrowhead at the
 * route's tip. `buildConnectorRoute`'s two branches (connector-paths.ts:
 * forward-nudge vs. back-detour) both always end with a horizontal run
 * INTO `[tipX, tipY]` moving in +x (traced in the task report) — the
 * arrowhead is a fixed right-pointing triangle, not direction-computed.
 */
function drawConnector(
  pdf: JsPDFInstance,
  route: ConnectorRoute,
  type: TaskDependency["type"],
  strokeRgb: RGB,
): void {
  const pts = parsePathPoints(route.d);
  if (pts.length < 2) return;
  pdf.setDrawColor(strokeRgb[0], strokeRgb[1], strokeRgb[2]);
  pdf.setLineWidth(0.75);
  pdf.setLineDashPattern(type === "SOFT" ? [2, 1.5] : [], 0);
  for (let i = 1; i < pts.length; i++) {
    pdf.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  pdf.setLineDashPattern([], 0); // reset — dash state persists across draws otherwise
  pdf.setFillColor(strokeRgb[0], strokeRgb[1], strokeRgb[2]);
  pdf.triangle(
    route.tipX, route.tipY,
    route.tipX - 4, route.tipY - 2.5,
    route.tipX - 4, route.tipY + 2.5,
    "F",
  );
}

interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Builds the final-page task table's head + body — "Section / Title /
 * Status / Priority / [Critical Path] / Start / Due". Pure and synchronous
 * (no jsPDF instance needed) so exportPdf.test.ts can assert on the table's
 * actual input directly, rather than driving the whole async PDF pipeline.
 *
 * Critical Path column (plan §3, empty-project rule): added only when at
 * least one row in `rows` carries the mark — a project with no marked task
 * gets the exact same 6-column table as before the mark shipped.
 */
export function buildTaskTable(
  rows: Row[],
): { head: string[]; body: string[][]; hasCriticalPath: boolean } {
  const taskRows = rows.filter((r) => r.kind === "task" || r.kind === "subtask");
  const sectionLookup = new Map<string, string>();
  for (const r of rows) {
    if (r.kind === "section") sectionLookup.set(r.id, r.name);
  }
  const hasCriticalPath = taskRows.some((r) => r.isCriticalPath);

  const head = ["Section", "Title", "Status", "Priority"];
  if (hasCriticalPath) head.push("Critical Path");
  head.push("Start", "Due");

  const body = taskRows.map((r) => {
    const t = r.task;
    const sectionName = r.parentRowId ? sectionLookup.get(r.parentRowId) ?? "" : "";
    // ASCII-safe indent — not a WinAnsi-encoding-representable glyph like
    // "└" (U+2514), which jsPDF's core helvetica font renders as mojibake
    // (confirmed against the F4 sample render: showed up as a stray "%").
    // Pre-existing bug (this string predates F4), fixed opportunistically
    // since this section was already being restyled.
    const indent = r.kind === "subtask" ? "    - " : "";
    const line = [
      sectionName,
      `${indent}${r.name}`,
      t ? TASK_STATUS_LABEL[t.status] ?? t.status : "",
      t ? PRIORITY_LABEL[t.priority] ?? t.priority : "",
    ];
    if (hasCriticalPath) line.push(r.isCriticalPath ? "Yes" : "");
    line.push(t?.startDate ? fmtIsoDate(parseISODate(t.startDate)) : "");
    line.push(t?.dueDate ? fmtIsoDate(parseISODate(t.dueDate)) : "");
    return line;
  });

  return { head, body, hasCriticalPath };
}

export async function exportGanttToPdf(opts: ExportPdfOpts): Promise<void> {
  const {
    projectName,
    rows,
    exportStart,
    exportEnd,
    holidays,
    colorBy,
    dependencies = [],
    tabWindow,
  } = opts;

  const jsPdfMod = await import("jspdf");
  const jsPDF = jsPdfMod.default;
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = autoTableMod.default;

  // ────────── Sheet geometry ──────────
  const margin = 24;
  const headerSpace = 28;
  // Layout: a label column for task names on the left, then the date grid.
  const labelColW = 160;
  const axisH = 22;
  const idealDayColW = 18;
  const minDayColW = 11;
  const idealWeekColW = 34; // width budget per 7-day block
  const minWeekColW = 20;
  const idealRowH = 18;
  const minRowH = 11;

  // ────────── Build day list ──────────
  const days: Date[] = [];
  let cur = startOfDay(exportStart);
  const endDay = startOfDay(exportEnd);
  while (cur <= endDay) {
    days.push(new Date(cur));
    cur = addDays(cur, 1);
  }
  const totalDays = days.length;

  // F3-consistent axis grain: sub-columns are DAYS (with day numbers) when
  // the exported range is narrow enough to stay readable; beyond that they
  // coarsen to WEEKS, mirroring the on-screen scale system's own
  // coarsening (SolvroGantt.tsx's SCALES comment: the "Week" pill is
  // day-grain over a ~1-month window, the "Month" pill is week-grain over a
  // ~1-quarter window). 60 days (~2 months) is the threshold — roughly the
  // point where a day-grain view would already have prompted a TAM to zoom
  // out to "Month" on screen. The tight ±7-day export window (SolvroGantt's
  // registration, unchanged by this task) keeps most real exports well
  // under this, so day-grain is the common case in practice; week-grain
  // exists for projects whose task range genuinely spans months.
  const WEEK_GRAIN_THRESHOLD_DAYS = 60;
  const grain: "day" | "week" = totalDays > WEEK_GRAIN_THRESHOLD_DAYS ? "week" : "day";

  // ────────── Label column: wrap, don't truncate ──────────
  // Row names used to be cut to one measured-fit line ("Setup and Config
  // Amazon Elastic Contai…"). They now wrap inside the same fixed-width
  // column and the row grows to hold the extra lines — the column width is
  // deliberately NOT stretched to the longest name, which would eat chart
  // width for one outlier row. MAX_LABEL_LINES caps a pathological title so a
  // single row cannot swallow the page; the last kept line still ellipsizes.
  // Measured on a throwaway document because the real one cannot be created
  // until the wrapped heights below decide the page size — jsPDF text metrics
  // depend only on the font and size, not on the page.
  const LABEL_FONT_SIZE = 8;
  const LABEL_LINE_H = 9.5;
  const LABEL_PAD_Y = 4;
  const MAX_LABEL_LINES = 4;

  const labelIndent = (row: Row) => row.depth * 10;
  const labelWidthFor = (row: Row) => labelColW - 8 - labelIndent(row);

  function wrapLabel(doc: JsPDFInstance, row: Row): string[] {
    doc.setFont("helvetica", row.kind === "section" ? "bold" : "normal");
    doc.setFontSize(LABEL_FONT_SIZE);
    const maxW = labelWidthFor(row);
    const lines = doc.splitTextToSize(row.name, maxW) as string[];
    if (lines.length <= MAX_LABEL_LINES) return lines.length > 0 ? lines : [""];
    const kept = lines.slice(0, MAX_LABEL_LINES);
    kept[MAX_LABEL_LINES - 1] = fitText(
      doc,
      lines.slice(MAX_LABEL_LINES - 1).join(" "),
      maxW,
    );
    return kept;
  }

  const measureDoc = new jsPDF({ unit: "pt", format: "a4" });
  const labelLines = rows.map((row) => wrapLabel(measureDoc, row));
  const wrappedRowH = labelLines.map((lines) =>
    Math.max(idealRowH, lines.length * LABEL_LINE_H + LABEL_PAD_Y * 2),
  );
  const wrappedTotalH = wrappedRowH.reduce((a, b) => a + b, 0);

  // ────────── Page size follows the chart ──────────
  // The chart sheet was a fixed A4 landscape regardless of project size, so a
  // long project was squeezed onto it — rows collapsed to the 11pt floor and
  // the date grid split across pages. The sheet is now cut to the chart's own
  // ideal size: every row at its wrapped-label height (>= `idealRowH`), the
  // whole date range at the ideal column width, on ONE page. A4 landscape
  // stays the floor so a small project still reads as a normal sheet, and
  // PDF_MAX_PT is the PDF format's own 200-inch user-space ceiling — a chart
  // past that ceiling falls back to the squeeze-then-paginate math below,
  // unchanged. The task table on the final page keeps its own A4 landscape
  // sheet.
  const A4_LANDSCAPE: [number, number] = [842, 595];
  const PDF_MAX_PT = 14400;
  const wantChartW =
    grain === "day"
      ? totalDays * idealDayColW
      : Math.ceil(totalDays / 7) * idealWeekColW;
  const pageW = Math.min(
    PDF_MAX_PT,
    Math.max(A4_LANDSCAPE[0], margin * 2 + labelColW + wantChartW),
  );
  const pageH = Math.min(
    PDF_MAX_PT,
    Math.max(A4_LANDSCAPE[1], margin * 2 + headerSpace + axisH + wrappedTotalH),
  );

  // The orientation must agree with the computed dimensions: jsPDF swaps
  // width and height when the named orientation contradicts them, which would
  // lay a tall, narrow chart (many rows, few days) on its side.
  const pdf = new jsPDF({
    orientation: pageW >= pageH ? "landscape" : "portrait",
    unit: "pt",
    format: [pageW, pageH],
  });
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2 - headerSpace;

  const onSurfaceRgb = hexToRgb(THEME_HEX.onSurface);
  const onSurfaceVariantRgb = hexToRgb(THEME_HEX.onSurfaceVariant);
  const outlineRgb = hexToRgb(THEME_HEX.outline);
  const outlineVariantRgb = hexToRgb(THEME_HEX.outlineVariant);
  const surfaceContainerLowRgb = hexToRgb(THEME_HEX.surfaceContainerLow);
  const surfaceContainerRgb = hexToRgb(THEME_HEX.surfaceContainer);
  const primaryRgb = hexToRgb(THEME_HEX.primary);
  // Critical Path mark (plan §3) — shared with exportExcel.ts via
  // palette.ts's CRITICAL_PATH_HEX, not a locally-duplicated literal.
  const criticalPathRgb = hexToRgb(CRITICAL_PATH_HEX);

  const today = startOfDay(new Date());
  const holidayDates = new Set(holidays.map((h) => h.date));
  const chartAreaW = usableW - labelColW;

  // `colW` is always px(pt)-per-DAY regardless of grain — bar/milestone/
  // connector geometry stays day-precise either way; grain only changes
  // what the axis draws (day ticks+numbers vs. week dividers+ISO week
  // labels) and, in week-grain, what width budget drives pagination.
  let colW: number;
  let daysPerPage: number;
  let pageCount: number;
  if (grain === "day") {
    if (totalDays * idealDayColW <= chartAreaW) {
      colW = chartAreaW / totalDays;
      daysPerPage = totalDays;
      pageCount = 1;
    } else if (totalDays * minDayColW <= chartAreaW) {
      colW = chartAreaW / totalDays;
      daysPerPage = totalDays;
      pageCount = 1;
    } else {
      colW = minDayColW;
      daysPerPage = Math.floor(chartAreaW / colW);
      pageCount = Math.ceil(totalDays / daysPerPage);
    }
  } else {
    const totalWeeks = Math.ceil(totalDays / 7);
    if (totalWeeks * idealWeekColW <= chartAreaW) {
      colW = chartAreaW / totalWeeks / 7;
      daysPerPage = totalDays;
      pageCount = 1;
    } else if (totalWeeks * minWeekColW <= chartAreaW) {
      colW = chartAreaW / totalWeeks / 7;
      daysPerPage = totalDays;
      pageCount = 1;
    } else {
      const weekColW = minWeekColW;
      colW = weekColW / 7;
      const weeksPerPage = Math.max(1, Math.floor(chartAreaW / weekColW));
      daysPerPage = weeksPerPage * 7;
      pageCount = Math.ceil(totalDays / daysPerPage);
    }
  }

  // Vertical: rows keep their own wrapped-label heights, because the page was
  // cut to hold exactly that. `wrapLabels` only turns false when the row count
  // pushed the sheet past PDF_MAX_PT and the labels no longer fit — then every
  // row falls back to one uniform squeezed height with a single truncated
  // label line, which is what this export did before wrapping existed.
  const visualRows = rows; // includes section header rows for context
  const rowsHeightAvail = usableH - axisH;
  const wrapLabels = wrappedTotalH <= rowsHeightAvail;
  const squeezedRowH = Math.max(
    minRowH,
    Math.min(idealRowH, rowsHeightAvail / Math.max(1, visualRows.length)),
  );
  const rowHeights = wrapLabels
    ? wrappedRowH
    : visualRows.map(() => squeezedRowH);
  const rowTops: number[] = [];
  let rowTopAcc = 0;
  for (const h of rowHeights) {
    rowTops.push(rowTopAcc);
    rowTopAcc += h;
  }
  const totalRowsH = rowTopAcc;
  // Bars keep one constant height across rows — a taller wrapped row adds
  // label space, not a fatter bar. Derived from `idealRowH` so an unwrapped
  // export is pixel-identical to the pre-wrap padding math.
  const barH = Math.max(
    3,
    Math.min(
      idealRowH - 2 * Math.max(2, idealRowH * 0.18),
      squeezedRowH - 2 * Math.max(2, squeezedRowH * 0.18),
    ),
  );

  function drawHeader(pageIdx: number): void {
    pdf.setTextColor(onSurfaceRgb[0], onSurfaceRgb[1], onSurfaceRgb[2]);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(projectName, margin, margin + 14);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(onSurfaceVariantRgb[0], onSurfaceVariantRgb[1], onSurfaceVariantRgb[2]);
    const right =
      pageCount > 1
        ? `Gantt · ${fmtIsoDate(new Date())} · page ${pageIdx + 1} of ${pageCount}`
        : `Gantt · ${fmtIsoDate(new Date())}`;
    pdf.text(right, pageW - margin, margin + 14, { align: "right" });
  }

  for (let p = 0; p < pageCount; p++) {
    if (p > 0) pdf.addPage();
    drawHeader(p);

    const dayFrom = p * daysPerPage;
    const dayTo = Math.min(dayFrom + daysPerPage, days.length);
    const pageDays = days.slice(dayFrom, dayTo);

    const chartLeft = margin + labelColW;
    const chartTop = margin + headerSpace + axisH;
    const chartBottom = chartTop + totalRowsH;
    const pageDaysW = pageDays.length * colW;
    const pageFromMs = pageDays[0].getTime();
    const pageToMs = pageDays[pageDays.length - 1].getTime();

    // ────────── Axis: month band (top half) + day/week sub-band (bottom half) ──
    const axisTop = margin + headerSpace;

    // Month bands (grain-independent — always the coarsest band).
    let runStart = 0;
    let runMonth = pageDays[0]?.getMonth() ?? -1;
    let runYear = pageDays[0]?.getFullYear() ?? -1;
    function flushMonthRun(toIdx: number) {
      const x = chartLeft + runStart * colW;
      const w = (toIdx - runStart) * colW;
      if (w <= 0) return;
      pdf.setFillColor(surfaceContainerLowRgb[0], surfaceContainerLowRgb[1], surfaceContainerLowRgb[2]);
      pdf.rect(x, axisTop, w, axisH / 2, "F");
      pdf.setDrawColor(outlineVariantRgb[0], outlineVariantRgb[1], outlineVariantRgb[2]);
      pdf.setLineWidth(0.3);
      pdf.rect(x, axisTop, w, axisH / 2);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(onSurfaceVariantRgb[0], onSurfaceVariantRgb[1], onSurfaceVariantRgb[2]);
      pdf.text(
        `${MONTHS[runMonth]} ${runYear}`,
        x + w / 2,
        axisTop + axisH / 2 - 3,
        { align: "center" },
      );
    }
    for (let i = 1; i < pageDays.length; i++) {
      const d = pageDays[i];
      if (d.getMonth() !== runMonth || d.getFullYear() !== runYear) {
        flushMonthRun(i);
        runStart = i;
        runMonth = d.getMonth();
        runYear = d.getFullYear();
      }
    }
    flushMonthRun(pageDays.length);

    // Sub-band: day ticks+numbers, or week dividers+ISO week labels.
    if (grain === "day") {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      for (let i = 0; i < pageDays.length; i++) {
        const d = pageDays[i];
        const cx = chartLeft + i * colW;
        pdf.setDrawColor(outlineVariantRgb[0], outlineVariantRgb[1], outlineVariantRgb[2]);
        pdf.setLineWidth(0.2);
        pdf.line(cx, axisTop + axisH / 2, cx, chartBottom);
        pdf.setTextColor(onSurfaceVariantRgb[0], onSurfaceVariantRgb[1], onSurfaceVariantRgb[2]);
        pdf.text(
          String(d.getDate()).padStart(2, "0"),
          cx + colW / 2,
          axisTop + axisH - 4,
          { align: "center" },
        );
      }
    } else {
      const boundaries: number[] = [0];
      for (let i = 1; i < pageDays.length; i++) {
        if (pageDays[i].getDay() === 1) boundaries.push(i); // Monday, weekStartsOn=1 (matches SolvroGantt.tsx)
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      for (let k = 0; k < boundaries.length; k++) {
        const startIdx = boundaries[k];
        const endIdx = k + 1 < boundaries.length ? boundaries[k + 1] : pageDays.length;
        const x = chartLeft + startIdx * colW;
        pdf.setDrawColor(outlineRgb[0], outlineRgb[1], outlineRgb[2]);
        pdf.setLineWidth(0.4);
        pdf.line(x, axisTop + axisH / 2, x, chartBottom);
        const segW = (endIdx - startIdx) * colW;
        pdf.setTextColor(onSurfaceVariantRgb[0], onSurfaceVariantRgb[1], onSurfaceVariantRgb[2]);
        pdf.text(`W${isoWeekNumber(pageDays[startIdx])}`, x + segW / 2, axisTop + axisH - 4, {
          align: "center",
        });
      }
    }
    // Right edge of grid
    pdf.setDrawColor(outlineVariantRgb[0], outlineVariantRgb[1], outlineVariantRgb[2]);
    pdf.setLineWidth(0.2);
    pdf.line(chartLeft + pageDaysW, axisTop + axisH / 2, chartLeft + pageDaysW, chartBottom);

    // ────────── Weekend / holiday tints (full body, grain-independent) ──────────
    for (let i = 0; i < pageDays.length; i++) {
      const d = pageDays[i];
      const iso = fmtIsoDate(d);
      const dow = d.getDay();
      const cx = chartLeft + i * colW;
      if (holidayDates.has(iso)) {
        const [r, g, b] = hexToRgb(HOLIDAY_HEX);
        pdf.setFillColor(r, g, b);
        pdf.rect(cx, chartTop, colW, totalRowsH, "F");
      } else if (dow === 0 || dow === 6) {
        const [r, g, b] = hexToRgb(WEEKEND_HEX);
        pdf.setFillColor(r, g, b);
        pdf.rect(cx, chartTop, colW, totalRowsH, "F");
      }
    }

    // ────────── Today line (primary green, only on the page containing today) ──
    const todayIdx = pageDays.findIndex((d) => d.getTime() === today.getTime());
    if (todayIdx >= 0) {
      const tx = chartLeft + todayIdx * colW + colW / 2;
      pdf.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      pdf.setLineWidth(1.2);
      pdf.line(tx, chartTop, tx, chartBottom);
    }

    // ────────── Rows: label column + bars/milestones/rollups ──────────
    const barRectsByTaskId = new Map<number, BarRect>();

    for (let r = 0; r < visualRows.length; r++) {
      const row = visualRows[r];
      const ry = chartTop + rowTops[r];
      const rh = rowHeights[r];

      if (row.kind === "section") {
        // Header band: subtler surface-container-low tint (was a raw slate
        // literal pre-F4).
        pdf.setFillColor(surfaceContainerLowRgb[0], surfaceContainerLowRgb[1], surfaceContainerLowRgb[2]);
        pdf.rect(margin, ry, labelColW + pageDaysW, rh, "F");
      }

      // Label cell — wrapped to the column width (`labelLines`, measured once
      // up front) and centered as a block in the row, at an x-offset by depth.
      // The squeezed fallback has no room for a second line, so it truncates to
      // one measured-fit line instead.
      const labelFontSize = wrapLabels ? LABEL_FONT_SIZE : rh < 14 ? 7 : 8;
      pdf.setFontSize(labelFontSize);
      pdf.setTextColor(onSurfaceRgb[0], onSurfaceRgb[1], onSurfaceRgb[2]);
      pdf.setFont("helvetica", row.kind === "section" ? "bold" : "normal");
      const indentPx = labelIndent(row);
      const labelMaxW = labelWidthFor(row);
      const drawLines = wrapLabels ? labelLines[r] : [fitText(pdf, row.name, labelMaxW)];
      const blockTop = ry + (rh - drawLines.length * LABEL_LINE_H) / 2;
      for (let li = 0; li < drawLines.length; li++) {
        pdf.text(
          drawLines[li],
          margin + 4 + indentPx,
          blockTop + LABEL_LINE_H * (0.75 + li),
        );
      }

      // Row separator (bottom) + vertical separator between label col and grid
      pdf.setDrawColor(outlineVariantRgb[0], outlineVariantRgb[1], outlineVariantRgb[2]);
      pdf.setLineWidth(0.3);
      pdf.line(margin, ry + rh, chartLeft + pageDaysW, ry + rh);
      pdf.line(chartLeft, ry, chartLeft, ry + rh);

      if (row.kind === "section") {
        // Slim rollup pill (~3pt), spanning the section's children date
        // range in the section color, drawn on the section's own resource
        // row (same placement as the live UI's rollup). SolvroBar.tsx's
        // on-screen `data-rollup` was restyled from a pill to a thin bar
        // with squared end caps in the Gantt visual refresh (Task 3); this
        // export still draws the rounded pill below — an accepted,
        // unsynced screen/PDF divergence, not a bug.
        if (row.start && row.end) {
          const startMs = startOfDay(row.start).getTime();
          const endMs = startOfDay(row.end).getTime();
          if (endMs >= pageFromMs && startMs <= pageToMs) {
            const clampedStartMs = Math.max(startMs, pageFromMs);
            const clampedEndMs = Math.min(endMs, pageToMs);
            const startIdx = (clampedStartMs - pageFromMs) / DAY_MS;
            const endIdx = (clampedEndMs - pageFromMs) / DAY_MS;
            const px = chartLeft + startIdx * colW + 1;
            const pw = Math.max(1, (endIdx - startIdx + 1) * colW - 2);
            const [pr, pg, pb] = hexToRgb(row.sectionColor ?? THEME_HEX.outline);
            pdf.setFillColor(pr, pg, pb);
            fillRoundedRect(pdf, px, ry + rh / 2 - 1.5, pw, 3, 1.5);
          }
        }
        continue;
      }

      // Bars/milestones (tasks/subtasks only).
      if (row.taskId == null) continue;

      let drawnRect: BarRect | null = null;

      if (row.isMilestone && row.end) {
        // Anchored on the due date only (never a stub range rect) — fixes a
        // pre-F4 gap where due-only milestones (no startDate) drew nothing
        // at all, since the old code gated on `row.start && row.end` and
        // geometry.ts's taskDates() leaves `start` null for a milestone
        // with no explicit startDate.
        const dayMs = startOfDay(row.end).getTime();
        if (dayMs >= pageFromMs && dayMs <= pageToMs) {
          const idx = (dayMs - pageFromMs) / DAY_MS;
          const dr = Math.min(5, Math.max(3, squeezedRowH * 0.25));
          const cx = chartLeft + idx * colW + 6;
          const cy = ry + rh / 2;
          // Primary green, not the resolved Color-by hex — parity with
          // SolvroBar.tsx's milestone branch, which hardcodes `bg-primary`
          // regardless of colorBy mode (an explicit "not section color"
          // choice ported from the old engine).
          pdf.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
          drawDiamond(pdf, cx, cy, dr);
          // Critical Path mark (plan §3): stroke the same diamond in
          // violet, on top of the fill — the PDF analogue of the on-screen
          // `outline outline-2 outline-offset-1` diamond ring.
          if (row.isCriticalPath) {
            pdf.setDrawColor(criticalPathRgb[0], criticalPathRgb[1], criticalPathRgb[2]);
            pdf.setLineWidth(0.75);
            drawDiamond(pdf, cx, cy, dr, "S");
          }
          // Label in on-surface (near-black), NOT the luminance-derived
          // insideLabelRgb SolvroBar.tsx uses for this text: on screen that
          // color is computed from the bar's resolved fill color even
          // though the milestone branch renders no colored backdrop behind
          // the label (just the diamond + text on the page/row background)
          // — porting it literally risks white-on-white text for any
          // colorBy mode whose fill luminance is under the 0.6 threshold
          // (e.g. IN_PROGRESS blue). Print legibility wins over literal
          // fidelity for this one spot; see task-f4-report.md.
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(squeezedRowH < 14 ? 6.5 : 7.5);
          pdf.setTextColor(onSurfaceRgb[0], onSurfaceRgb[1], onSurfaceRgb[2]);
          const labelX = cx + dr + 4;
          const labelMaxW = Math.max(0, chartLeft + pageDaysW - labelX - 2);
          pdf.text(fitText(pdf, row.name, labelMaxW), labelX, cy + 2.5);

          drawnRect = { x: cx - dr, y: cy - barH / 2, width: dr * 2, height: barH };
        }
      } else if (row.start && row.end) {
        const startMs = startOfDay(row.start).getTime();
        const endMs = startOfDay(row.end).getTime();
        if (endMs >= pageFromMs && startMs <= pageToMs) {
          const clampedStartMs = Math.max(startMs, pageFromMs);
          const clampedEndMs = Math.min(endMs, pageToMs);
          const startIdx = (clampedStartMs - pageFromMs) / DAY_MS;
          const endIdx = (clampedEndMs - pageFromMs) / DAY_MS;
          const bx = chartLeft + startIdx * colW + 1;
          const bw = Math.max(1, (endIdx - startIdx + 1) * colW - 2);
          // Constant bar height, vertically centered — a row made taller by a
          // wrapped label gets more label room, not a fatter bar.
          const bh = barH;
          const by = ry + (rh - bh) / 2;
          const startsOnPage = startMs >= pageFromMs;

          const status = row.status ?? "TODO";
          const priority = row.priority ?? "MEDIUM";
          const fillHex = barFillHex(
            { status, priority, sectionColor: row.sectionColor },
            colorBy,
          );
          const [fr, fg, fb] = hexToRgb(fillHex);
          pdf.setFillColor(fr, fg, fb);
          fillRoundedRect(pdf, bx, by, bw, bh, 1.5);

          // Critical Path mark (plan §3): a violet stroke on the same
          // rounded rect, right after the fill — the PDF analogue of the
          // on-screen `ring-2 ring-inset` bar overlay. No restore needed
          // after: every later `setDrawColor`/`setLineWidth` call in this
          // file (row separators, the diamond stroke, connectors, the
          // outer chart border) sets its own color/width before drawing
          // rather than relying on whatever was last left set.
          if (row.isCriticalPath) {
            pdf.setDrawColor(criticalPathRgb[0], criticalPathRgb[1], criticalPathRgb[2]);
            pdf.setLineWidth(0.75);
            fillRoundedRect(pdf, bx, by, bw, bh, 1.5, "S");
          }

          // Progress overlay — darker fill on the completed fraction, only
          // for 0%<p<100%, and only on the page where the bar STARTS (a
          // multi-page-spanning bar is a rare edge case for the tight
          // ±7-day export window; the % is computed against the bar's
          // FULL — not page-clamped — duration so a right-clipped bar on a
          // very wide export still shows the correct fraction).
          const progress = row.progressPct;
          if (
            startsOnPage &&
            typeof progress === "number" &&
            progress > 0 &&
            progress < 100
          ) {
            const trueEndIdx = (endMs - pageFromMs) / DAY_MS;
            const fullBw = (trueEndIdx - startIdx + 1) * colW - 2;
            const progressW = Math.min(bw, Math.max(0, fullBw * (progress / 100)));
            if (progressW > 0) {
              withOpacity(pdf, PROGRESS_OVERLAY_ALPHA, () => {
                pdf.setFillColor(0, 0, 0);
                fillRoundedRect(pdf, bx, by, progressW, bh, 1.5);
              });
            }
          }

          // Label: inside if it fits (GH #58-style measured fit), else
          // immediately right of the bar in on-surface-variant gray. Only
          // on the page where the bar starts, matching the pre-F4 file's
          // own no-duplicate-across-pages guard.
          if (startsOnPage) {
            const labelSize = squeezedRowH < 14 ? 6.5 : 7.5;
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(labelSize);
            const insidePad = 6;
            const fitsInside = pdf.getTextWidth(row.name) + insidePad <= bw;
            if (fitsInside) {
              const [tr, tg, tb] = insideLabelRgb(fillHex);
              pdf.setTextColor(tr, tg, tb);
              pdf.text(row.name, bx + insidePad / 2, by + bh / 2 + 2);
            } else {
              pdf.setTextColor(onSurfaceVariantRgb[0], onSurfaceVariantRgb[1], onSurfaceVariantRgb[2]);
              const labelX = bx + bw + 4;
              const labelMaxW = Math.max(0, chartLeft + pageDaysW - labelX - 2);
              pdf.text(fitText(pdf, row.name, labelMaxW), labelX, by + bh / 2 + 2);
            }
          }

          drawnRect = { x: bx, y: by, width: bw, height: bh };
        }
      }

      if (drawnRect) {
        // Baseline ghosts are intentionally NOT rendered in the PDF (user
        // direction, 2026-07-25 — see CHANGELOG.md) even though the project
        // may have a locked baseline; the on-screen `showBaseline` toggle
        // and its ghosts (GanttOverlay.tsx) are unaffected by this.
        barRectsByTaskId.set(row.taskId, drawnRect);
      }
    }

    // ────────── Dependency connectors — stepped routes reused from the
    // live overlay's own route builder, drawn once bar/milestone rects for
    // this page are all known. A dependency whose predecessor or successor
    // isn't drawn on THIS page (off-window, or clipped past the page's day
    // range) is simply skipped for that page — same acceptance GanttOverlay
    // itself documents for a collapsed-away endpoint. ──────────
    for (const dep of dependencies) {
      const predRect: Rect | undefined = barRectsByTaskId.get(dep.predecessorTaskId);
      const succRect: Rect | undefined = barRectsByTaskId.get(dep.successorTaskId);
      if (!predRect || !succRect) continue;
      const route = buildConnectorRoute(predRect, succRect);
      drawConnector(pdf, route, dep.type, onSurfaceVariantRgb);
    }

    // Outer chart border
    pdf.setDrawColor(outlineRgb[0], outlineRgb[1], outlineRgb[2]);
    pdf.setLineWidth(0.4);
    pdf.rect(chartLeft, chartTop, pageDaysW, totalRowsH);
    pdf.rect(margin, chartTop, labelColW, totalRowsH);
  }

  // ────────── Final page: task table ──────────
  // Its own A4 landscape sheet — the table is 6 narrow columns and gains
  // nothing from the chart sheet's width, which can now be several times A4.
  // jsPDF keeps this format for any further page autoTable adds itself.
  pdf.addPage(A4_LANDSCAPE, "landscape");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(onSurfaceRgb[0], onSurfaceRgb[1], onSurfaceRgb[2]);
  pdf.text(`${projectName} — Tasks`, margin, margin + 14);

  const { head, body: tableRows, hasCriticalPath } = buildTaskTable(rows);
  // Critical Path column (plan §3, empty-project rule): present only when
  // `buildTaskTable` reports at least one exported task row is marked —
  // when it doesn't, every column index below matches the pre-mark table
  // byte-for-byte.
  const columnStyles: Record<number, { cellWidth: number | "auto" }> = {
    0: { cellWidth: 100 },
    1: { cellWidth: "auto" },
    2: { cellWidth: 70 },
    3: { cellWidth: 60 },
  };
  if (hasCriticalPath) columnStyles[4] = { cellWidth: 70 };
  columnStyles[head.length - 2] = { cellWidth: 70 }; // Start
  columnStyles[head.length - 1] = { cellWidth: 70 }; // Due

  autoTable(pdf, {
    startY: margin + 28,
    margin: { left: margin, right: margin },
    head: [head],
    body: tableRows,
    styles: { fontSize: 8, cellPadding: 3, textColor: onSurfaceRgb },
    headStyles: {
      fillColor: surfaceContainerRgb,
      textColor: onSurfaceRgb,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: surfaceContainerLowRgb },
    columnStyles,
  });

  if (tabWindow !== undefined) {
    // Browser-viewer path: renders the PDF in a tab instead of downloading it.
    // Chromium-family browsers block downloads that originate from a
    // non-trustworthy origin, and prod is served over plain HTTP — a tab
    // navigation never enters the download pipeline, so it is unaffected.
    const blobUrl = String(pdf.output("bloburl"));
    if (tabWindow) {
      tabWindow.location.href = blobUrl;
    } else {
      const w = window.open(blobUrl, "_blank");
      if (!w) {
        throw new Error(
          "Pop-up blocked — allow pop-ups for this site to view the PDF.",
        );
      }
    }
  } else {
    pdf.save(`${slugify(projectName)}_gantt_${fmtIsoDate(new Date())}.pdf`);
  }
}
