import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseISO } from "date-fns";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  CRITICAL_PATH_GLYPH,
  CRITICAL_PATH_LABEL,
  CriticalPathMark,
} from "@/components/CriticalPathMark";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { dateToDay } from "@/lib/dateField";
import { usePointerPressActivity } from "@/lib/dragActivity";
import { fmtDateTime } from "@/lib/formatDate";
import { useGanttExport } from "@/lib/gantt/exportContext";
import { addDays, buildRows, rowsDateRange, startOfDay, type Row } from "@/lib/gantt/geometry";
import {
  DEFAULT_SECTION_COLOR,
  legendEntries,
  resolveSectionColors,
  type ColorByMode,
} from "@/lib/gantt/palette";
import {
  type CreateDependencyInput,
  type Task,
  useCreateDependency,
  useCreateSection,
  useDeleteDependency,
  useDeleteTask,
  useDuplicateTask,
  useHolidays,
  useProjectDependencies,
  useProjectEpics,
  useProjectSections,
  useProjectTasks,
  useUpdateSection,
  useUpdateTask,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  Gantt,
  type GanttApi,
  type GanttColumn,
  useGanttNavigation,
} from "@/components/reui/gantt/gantt";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GanttView } from "@/components/reui/gantt/gantt-view";
import type {
  GanttEvent,
  GanttProposedUpdate,
  GanttResourceReorder,
  GanttScale,
  GanttUpdateResult,
} from "@/components/reui/gantt/gantt-types";
import {
  buildEvents,
  buildResources,
  buildRollupEvents,
  eventPatch,
  parseTaskId,
  sectionNodeId,
  taskNodeId,
} from "./adapter";
import { TableSkeleton } from "@/components/skeletons";
import { GanttOverlay } from "./GanttOverlay";
import { SolvroBar } from "./SolvroBar";
import {
  SectionColorCell,
  TaskDatesCell,
  TaskStatusCell,
  TaskStatusDot,
} from "./TreeCells";

// Plan B Task 4 — SolvroBar owns every bar's inner content (solid fills,
// milestones, rollup pills, measured-fit labels, the dormant AI-glow hook).
// `overflow-visible` is what lets its "outside" label escape the button's
// box; the bg-transparent trio neutralizes the built-in 20%-opacity ghost
// track across base/hover/selected states (three separate tailwind-merge
// conflict groups — all three must be named or the ghost look flashes back
// on hover/select). See SolvroBar.tsx's file header for the full rationale.
const SOLVRO_EVENT_CLASSNAMES = "overflow-visible bg-transparent hover:bg-transparent data-selected:bg-transparent";

export interface SolvroGanttProps {
  projectId: number;
  projectName: string;
  baselineLockedAt: string | null;
  baselineLockedBy: { id: number; username: string } | null;
  onEditTask: (task: Task) => void;
  // T5 (gantt visual refresh) — `parentTaskId` is new, optional so the
  // pre-existing "+ Task" toolbar call site (`onCreateTaskOpen(null)`)
  // keeps compiling unchanged. Only the row menu's "Add subtask" action
  // (below) passes it, pre-parenting the create modal to the row's task.
  onCreateTaskOpen: (sectionId: number | null, parentTaskId?: number | null) => void;
}

// Plan B Task 9 walkthrough fix (Finding F3) — the four zoom-pill LABELS are
// ported verbatim from GanttFrame.tsx:65-70 (Day/Week/Month/Quarter), but
// each is now remapped one ReUI GanttScale step coarser than its own name.
// ReUI's scale names are CALENDAR-period names (how much time is visible),
// not column-GRAIN names (what each column represents) — the two only
// happen to line up for "day" itself. Traced the actual column grain each
// scale renders in gantt-view.tsx's unit-building useMemo (:393-553):
//   "day"     → units = HOUR-ish intervals within a day, groups = days
//   "week"    → units = DAYS (7 of them), groups = weeks      \_ identical
//   "month"   → units = DAYS (a calendar month's worth), groups = weeks /  grain
//   "quarter" → units = WEEKS (week-aligned), groups = months
//   "year"    → units = MONTHS (calendar months), groups = quarters
// A literal mode:"day"/"week"/"month"/"quarter" mapping therefore rendered
// one level too fine for every pill's label (e.g. the "Day" pill showed
// HOUR columns, not day columns). Remapped so each pill's underlying scale
// renders the column grain its LABEL promises:
//   Day pill     → ReUI "week"    (day columns, ~1-week initial window)
//   Week pill    → ReUI "month"   (day columns, ~1-month initial window —
//                                  closest to the old engine's Week mode:
//                                  day-granular with weekend shading, just
//                                  a wider initial window; stays the default)
//   Month pill   → ReUI "quarter" (week columns under month bands)
//   Quarter pill → ReUI "year"    (month columns under quarter bands)
// ReUI's own "day" GanttScale (hour columns) has no pill in this toolbar —
// same as the old engine, which never exposed an hour-granular mode either.
const SCALES: Array<{ mode: GanttScale; label: string }> = [
  { mode: "week", label: "Day" },
  { mode: "month", label: "Week" },
  { mode: "quarter", label: "Month" },
  { mode: "year", label: "Quarter" },
];

// T6 (fix round, user-reported: toolbar "cards" rendered at visibly
// different sizes) — every segmented-pill item (buttons AND the Color-by
// menu trigger) shares this exact box height, with vertical padding (py-*)
// dropped everywhere in favor of it + `items-center`. The mismatch wasn't
// container padding (that was already identical — `p-0.5` everywhere) but
// CONTENT-driven sizing: text-label-caps carries line-height 1 while the
// arbitrary text-[11.5px] used elsewhere inherits the ambient ~1.5, the
// "add" icon was text-base (17px) against every other icon's 15px, and a
// native <select>'s UA chrome renders taller than a <button> at matching
// padding. An explicit height makes the box immune to all three.
const TOOLBAR_ITEM_HEIGHT = "h-7";

// Ported verbatim from GanttFrame.tsx:72 — same key, same values, so a user's
// existing pick survives the engine swap.
const COLOR_BY_STORAGE_KEY = "solvro.gantt.colorBy";

// Color-by menu (2026-08-31): mode order + labels for the radio items and
// the trigger's current-mode text.
const COLOR_BY_MODES: readonly ColorByMode[] = ["status", "section", "priority"];
const COLOR_BY_LABELS: Record<ColorByMode, string> = {
  status: "Status",
  section: "Section",
  priority: "Priority",
};

// Walkthrough F6 (2026-07-25) — tree-pane width persistence, same pattern as
// COLOR_BY_STORAGE_KEY above. The vendored engine already ships a controlled
// tree-panel width + a built-in draggable splitter (GanttTreePanelConfig,
// reui/gantt/gantt.tsx:1218-1231, forwarded via VIEW_CONFIG_KEYS:1479 and
// rendered at reui/gantt/gantt-view.tsx:2260-2308) — no vendored-file patch
// needed, just wiring from here. min/max mirror that file's own
// DEFAULT_TREE_PANEL (gantt-view.tsx:203-209); the default is deliberately
// wider than the engine's 288 — see the issue #118 block below.
// Width-key history: every name-column formula change gets a NEW key plus a
// one-time migration from the old ones (precedent set at #118's v1 → v2) —
// a stored width read back under a different formula silently mis-sizes the
// name column (the v2-era 364 default under the current formula would floor
// it at its 100px minimum). Formulas: v2 sized the name column as
// `stored − 156`; v3 as `stored − 316 − 34` while the short-lived "Due"
// column existed; v4 is `stored − 256 − 34` after its 2026-08-03 removal.
const TREE_WIDTH_STORAGE_KEY = "solvro.gantt.treeWidth.v4";
// Due-column-era key (written only on 2026-08-03). Its values assume the
// 316px fixed set, so they carry +60 relative to v4; read once by
// readStoredTreeWidth's migration and otherwise left untouched — same
// "leave old keys in place" convention the v2/v1 keys below follow.
const TREE_WIDTH_V3_LEGACY_STORAGE_KEY = "solvro.gantt.treeWidth.v3";
// Pre-v3 (T2) key. Its values assumed the v2 name-column formula
// (`stored − 156`); read once by readStoredTreeWidth's migration and
// otherwise left untouched.
const TREE_WIDTH_V2_LEGACY_STORAGE_KEY = "solvro.gantt.treeWidth.v2";
// Pre-#118 key. Its values assumed the original (pre-v2) name-column
// formula; read once by readStoredTreeWidth's migration and otherwise left
// untouched.
const TREE_WIDTH_LEGACY_STORAGE_KEY = "solvro.gantt.treeWidth";
// The gantt-visual-refresh phase bumped this from 364 to 498: +100 for the
// Status column joining the fixed set below, then +34 for the two
// adornments the phase put INSIDE the name cell (status dot ≈14px, hover
// "…" actions button ≈20px — invisible but always in layout). Net: the
// name column is 242px (498 − 256), of which 208px is text room — the same
// 208px the old 364 default gave. (A short-lived 60px "Due" column pushed
// this to 558 before its 2026-08-03 removal.) A user's already-persisted
// `TREE_WIDTH_STORAGE_KEY` (or a value migrated up from an older key, see
// readStoredTreeWidth) wins over this default regardless.
const TREE_PANEL_DEFAULT_WIDTH = 498;
const TREE_PANEL_MIN_WIDTH = 180;
// The phase bumped this from 640 to 774 to keep the same 484px of MAX
// name-column TEXT room (774 − 256 fixed columns − 34 in-cell adornments)
// that the pre-phase Dates/color-only layout gave (640 − 156 = 484), by
// the same +34 fold as TREE_PANEL_DEFAULT_WIDTH above.
const TREE_PANEL_MAX_WIDTH = 774;
// Issue #118 — the name column used to mirror the engine's 208px default and
// absorb the splitter delta on top of it, which left the fixed "Dates"/color
// columns to its right (gantt-view.tsx:1834-1863) clipped past the pane edge
// at EVERY pane width. The name column is now the pane REMAINDER after those
// fixed columns, and the default pane width is
// 498 = 208 + 34 + 132 + 24 + 100 (208 = old title room; 34 = in-cell
// dot/"…" adornments; 132/24 = the original Dates/color columns; 100 = the
// Status column), so a first-visit gantt keeps the old 208px title room AND
// shows the full DD/MM – DD/MM range + status chip + color swatch; each
// splitter pixel still lands on the title 1:1 (F6's point, walkthrough
// 2026-07-25). Two known residuals, both pre-existing and now slightly
// wider in their trigger range since the fixed-column total grew from 156px
// to 256px: below a (256 + 100 =) 356px pane the name column floors at its
// min and the fixed columns clip again (a deliberate user narrowing, not
// the default — was 256px pre-T2), and on narrow desktop viewports the
// engine renders the pane narrower than `treeWidth` without reporting it
// (clampContainer, gantt-view.tsx:977-987), so a wide persisted width can
// still clip the columns there — docs/ISSUES.md.
const TREE_DATES_COLUMN_WIDTH = 132;
const TREE_COLOR_COLUMN_WIDTH = 24;
// Height-style Status chip column. 100px comfortably fits the widest chip
// label ("In progress") without truncating. Renders at a FIXED width
// regardless of pane width — gantt-view.tsx's tree-column-cell wrapper is
// `shrink-0`, so a narrower pane makes the ROW scroll horizontally, not the
// column shrink (see the residuals note above). The truncate/overflow-hidden
// guards in TreeCells.tsx exist purely as defense against unusually long
// CONTENT (e.g. a future locale with longer status words) overflowing that
// fixed width, not against the pane narrowing. A separate "Due" column
// shipped briefly and was removed 2026-08-03 as redundant with the Dates
// range — the overdue treatment lives in the Dates cell now.
const TREE_STATUS_COLUMN_WIDTH = 100;
const TREE_FIXED_COLUMNS_WIDTH =
  TREE_DATES_COLUMN_WIDTH +
  TREE_COLOR_COLUMN_WIDTH +
  TREE_STATUS_COLUMN_WIDTH;
const TREE_NAME_COLUMN_MIN_WIDTH = 100;

function clampTreeWidth(width: number): number {
  return Math.min(Math.max(width, TREE_PANEL_MIN_WIDTH), TREE_PANEL_MAX_WIDTH);
}

function readStoredTreeWidth(): number {
  const raw = localStorage.getItem(TREE_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) return clampTreeWidth(parsed);
  // One-time v3 → v4 migration: v3 values were written while the removed
  // 60px "Due" column sat in the fixed set, so they carry +60 relative to
  // the current formula — migrate down so the pane actually shrinks for
  // anyone who opened the Gantt during the Due-column window. The
  // mount-time persistence effect writes the result to the v4 key, so each
  // legacy branch here runs once per browser.
  const v3Raw = localStorage.getItem(TREE_WIDTH_V3_LEGACY_STORAGE_KEY);
  const v3 = v3Raw ? Number(v3Raw) : NaN;
  if (Number.isFinite(v3)) return clampTreeWidth(v3 - 60);
  // One-time v2 → v4 migration (see the key-history note above): v2's
  // formula sized the name column as `stored − 156`; v4 sizes its TEXT room
  // as `stored − 256 − 34` (Status fixed column + the in-cell dot and "…"
  // button). +134 keeps each user's persisted title text width exactly as
  // it was (the 774 pane max permitting).
  const v2Raw = localStorage.getItem(TREE_WIDTH_V2_LEGACY_STORAGE_KEY);
  const v2 = v2Raw ? Number(v2Raw) : NaN;
  if (Number.isFinite(v2)) return clampTreeWidth(v2 + 134);
  // One-time v1 → v4 migration, for a browser that never picked up the v2
  // key at all — compounds the historical offsets (v1 → v2's own +76, then
  // +134 above) into a single +210 jump straight to v4.
  const legacyRaw = localStorage.getItem(TREE_WIDTH_LEGACY_STORAGE_KEY);
  const legacy = legacyRaw ? Number(legacyRaw) : NaN;
  if (Number.isFinite(legacy)) return clampTreeWidth(legacy + 210);
  return TREE_PANEL_DEFAULT_WIDTH;
}

// Plan B Task 7 (fix pass) — geometry's buildRows() takes a collapsed-row Set
// keyed by the OLD engine's row-id shape (geometry.ts:458-467: section groups
// are `sec-<id>` / `sec-none`; task-with-subtask groups are `task-<id>`,
// geometry.ts:413). ReUI's own controlled collapse API (`collapsedGroups`/
// `onCollapsedGroupsChange`, gantt.tsx:1344-1348) reports ids in the
// RESOURCE-NODE id shape instead (adapter.ts's `sectionNodeId`/`taskNodeId`:
// `section-<id>` / `section-none` for sections, `task-<id>` for tasks) — the
// task-id shape happens to already match geometry.ts's, but the section
// prefix differs ("section-" vs "sec-"), so a straight pass-through would
// silently fail to collapse any section row in the export. This maps ReUI's
// ids onto geometry's shape; task ids pass through unchanged.
function toGeometryCollapsedIds(resourceIds: string[]): Set<string> {
  return new Set(
    resourceIds.map((id) =>
      id === "section-none"
        ? "sec-none"
        : id.startsWith("section-")
          ? `sec-${id.slice("section-".length)}`
          : id,
    ),
  );
}

/**
 * Port of GanttFrame.tsx:356-364's `yearsCovered` memo, re-derived from the
 * adapter's Date-valued events instead of the old geometry module's padded
 * chartStart/chartEnd window — ReUI has no such upfront window (it scrolls
 * infinitely), so the holiday-year span is just the min/max year the actual
 * task bars touch. Falls back to the current year with no dated tasks, same
 * as the old memo's `!chartStart` branch.
 */
function yearsCoveredBy(events: Array<{ start: Date; end: Date }>): number[] {
  if (events.length === 0) return [new Date().getFullYear()];
  let min = Infinity;
  let max = -Infinity;
  for (const e of events) {
    min = Math.min(min, e.start.getFullYear());
    max = Math.max(max, e.end.getFullYear());
  }
  const out: number[] = [];
  for (let y = min; y <= max; y++) out.push(y);
  return out;
}

/**
 * T1 (fix round) — invisible bridge child so the toolbar (a SIBLING that
 * renders above <Gantt>, with no context of its own) can show the engine's
 * own live nav title. Must be a child of <Gantt> to call useGanttNavigation
 * (gantt.tsx:1702, throws outside <Gantt>'s context) — that hook's `title`
 * already follows scroll-driven viewportCenter moves (gantt.tsx:950-967,
 * documented at gantt-types.tsx:195-201), not just the anchor date, so this
 * stays correct through drag/scroll, not only prev/next/today presses.
 */
function GanttNavTitleSync({ onTitleChange }: { onTitleChange: (title: string) => void }) {
  const { title } = useGanttNavigation();
  useEffect(() => {
    onTitleChange(title);
  }, [title, onTitleChange]);
  return null;
}

export function SolvroGantt(props: SolvroGanttProps) {
  const { projectId, projectName, baselineLockedAt, baselineLockedBy, onEditTask, onCreateTaskOpen } =
    props;

  const { user } = useAuth();
  // Ported verbatim from GanttFrame.tsx:86-87.
  const canEdit = hasPermission(user, "task:write");
  // Pauses the project queries' 30 s refresh while a bar move/resize, row
  // reorder or connect-dot drag is live (the vendored engine has no
  // start/end callbacks) — docs/archive/plans/collaboration-and-sharing.md.
  usePointerPressActivity("[data-slot=gantt]", canEdit);

  const { data: tasks = [], isLoading, isError, error } = useProjectTasks(projectId);
  const { data: sections = [] } = useProjectSections(projectId);
  // Epics feed only the Excel export's "Epic" column (exportExcel.ts).
  const { data: epics = [] } = useProjectEpics(projectId);
  // Plan B Task 6 — the overlay (connectors, drag-create, baselines) is the
  // consumer this query was wired ahead of in Task 4/5; now actually used.
  const { data: dependencies = [] } = useProjectDependencies(projectId);

  const updateTask = useUpdateTask(projectId);
  const updateSection = useUpdateSection(projectId);
  const createSection = useCreateSection(projectId);
  // Invalidate-only (queries.ts:1308,1336) — no optimistic connector add/
  // remove, matching the old engine's dependency mutations exactly.
  const createDependency = useCreateDependency(projectId);
  const deleteDependency = useDeleteDependency(projectId);
  // T5 (gantt visual refresh) — row menu's Delete action. Invalidate-only,
  // same shape as every other mutation in this file (no optimistic write:
  // deletion isn't inline-edit territory per frontend/CLAUDE.md's
  // convention split).
  const deleteTask = useDeleteTask(projectId);
  // Row menu's Duplicate action — POST /tasks/:id/duplicate; the copy lands
  // directly after the source row. Invalidate-only, same shape as
  // deleteTask above.
  const duplicateTask = useDuplicateTask(projectId);
  const ganttContainerRef = useRef<HTMLDivElement | null>(null);

  // Plan B Task 9 (F3 fix) — default is the "Week" pill, whose underlying
  // ReUI scale is now "month" (see SCALES' comment above), not literally
  // "week" — day-granular columns, closest to the old engine's Week-mode
  // default look.
  const [scale, setScale] = useState<GanttScale>("month");
  // T1 (fix round) — toolbar nav title (e.g. "July 2026"), lifted out of
  // <Gantt>'s own context by the GanttNavTitleSync bridge child below: the
  // sibling toolbar that renders it has no context access of its own, but
  // GanttNavTitleSync calls the vendored useGanttNavigation() from inside
  // <Gantt> and pushes its live `title` up here on every change — including
  // scroll-driven viewportCenter moves (gantt.tsx:950-967), not just
  // button presses.
  const [navTitle, setNavTitle] = useState("");
  const [showBaseline, setShowBaseline] = useState(false);
  // Plan B Task 7 (fix pass) — controlled collapse state, wired into
  // <Gantt>'s `collapsedGroups`/`onCollapsedGroupsChange` (gantt.tsx:1344-
  // 1348) below. Default `[]` (fully expanded) matches the old engine's
  // initial `collapsed` Set (GanttFrame.tsx:158). Fed into the export effect
  // (via `toGeometryCollapsedIds`, above) so exports match on-screen collapse
  // exactly like the old engine did — see CHANGELOG.md's Task 7 entry.
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  // Ported verbatim from GanttFrame.tsx:151-157, including its actual default
  // ("section", not "status" — the skeleton's stated default of "status"
  // disagrees with the shipped GanttFrame.tsx behavior this task is porting
  // parity from; verbatim porting wins so existing localStorage picks and
  // first-run visuals don't regress).
  const [colorBy, setColorBy] = useState<ColorByMode>(() => {
    const v = localStorage.getItem(COLOR_BY_STORAGE_KEY);
    return v === "section" || v === "priority" || v === "status" ? v : "section";
  });
  useEffect(() => {
    localStorage.setItem(COLOR_BY_STORAGE_KEY, colorBy);
  }, [colorBy]);

  // Walkthrough F6 (2026-07-25) — draggable tree-pane splitter. `treeWidth`
  // is the LIVE width, following every drag/keyboard/reset commit via
  // `onWidthChange` (gantt-view.tsx:1081-1083,2295) — it's what the derived
  // name-column width below tracks. `initialTreeWidth` is a SEPARATE frozen
  // mount-time snapshot (read once, never updated) used only as the
  // `treePanel.width` prop.
  //
  // F6 follow-up (2026-07-25, post-review) — the two must NOT be the same
  // value: the engine's splitter double-click handler resets to whatever
  // `treeConfig.width` (our `treePanel.width` prop) evaluates to FRESH each
  // render (gantt-view.tsx:2283-2286: `setTreeWidth(treeConfig.width)` then
  // `treeConfig.onWidthChange?.(treeConfig.width)`) — binding that prop to
  // the live `treeWidth` state made "reset" a permanent no-op, since it
  // would always read back the value it had just set. Freezing it at mount
  // instead makes double-click a real "undo my drag(s) this page load"
  // affordance, resetting to the width the gantt actually opened with
  // (whatever was last persisted, or the engine default if nothing was).
  // Confirmed the reset path DOES fire `onWidthChange` (traced above), so
  // `treeWidth`/localStorage correctly follow a reset with no extra wiring.
  const [initialTreeWidth] = useState<number>(readStoredTreeWidth);
  const [treeWidth, setTreeWidthState] = useState<number>(initialTreeWidth);
  const handleTreeWidthChange = useCallback((width: number) => {
    setTreeWidthState(clampTreeWidth(width));
  }, []);
  // Persistence lives in its own effect, same pattern as colorBy just above
  // (state is the single source of truth; the effect is a pure side-mirror
  // of it, not fused into the mutator) — also fires once on mount, mirroring
  // colorBy's own mount-time write-back of whatever was just read.
  useEffect(() => {
    localStorage.setItem(TREE_WIDTH_STORAGE_KEY, String(treeWidth));
  }, [treeWidth]);
  // Pane-remainder sizing (issue #118): the three fixed columns (Status/
  // Dates/color) fit inside the pane wherever the pane is ≥ 356px and rendered at `treeWidth`
  // (residuals in the constants block above), and every pixel of splitter
  // drag still goes to the name column 1:1, so dragging reveals more of a
  // truncated title without pushing the date range back out of view.
  const nameColumnWidth = Math.max(
    TREE_NAME_COLUMN_MIN_WIDTH,
    treeWidth - TREE_FIXED_COLUMNS_WIDTH,
  );
  // Memoized: gantt.tsx:1623-1634 hands GanttViewConfigContext consumers the
  // PREVIOUS config object across renders unless a value actually changed
  // (shallowEqualRecord) — passing a fresh `treePanel` object literal every
  // render would defeat that and force the whole tree pane to re-measure on
  // every unrelated re-render (e.g. every task refetch).
  const treePanel = useMemo(
    () => ({
      width: initialTreeWidth,
      minWidth: TREE_PANEL_MIN_WIDTH,
      maxWidth: TREE_PANEL_MAX_WIDTH,
      nameColumnWidth,
      onWidthChange: handleTreeWidthChange,
    }),
    [initialTreeWidth, nameColumnWidth, handleTreeWidthChange],
  );

  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  // T5 (gantt visual refresh) — row menu's Delete action, confirmed via the
  // shared ConfirmModal (mirrors TaskPanel.tsx's confirmDelete pattern) —
  // never a bare window.confirm.
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  // Export menu — ported verbatim from GanttFrame.tsx:104-107,123-132.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportMenuOpen) return;
    function onDocPointer(e: PointerEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [exportMenuOpen]);

  // The lock/reset flow lives in the Context panel
  // (components/layout/RightSidebar.tsx, 2026-08-31); the toolbar only
  // toggles the ghosts and reports the lock state in the toggle's tooltip.
  const baselineLockedAtPretty = baselineLockedAt ? fmtDateTime(baselineLockedAt) : null;

  const resources = useMemo(() => buildResources(tasks, sections), [tasks, sections]);
  const events = useMemo<GanttEvent<Task>[]>(
    () => [...buildEvents(tasks, sections, colorBy, canEdit), ...buildRollupEvents(tasks, sections)],
    [tasks, sections, colorBy, canEdit],
  );
  const years = useMemo(() => yearsCoveredBy(events), [events]);
  const { data: holidays = [] } = useHolidays(years);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Plan B Task 7 (fix pass) — built the same way the old engine built its
  // export `rows` (GanttFrame.tsx:324-329): geometry's row builder over the
  // SAME tasks/sections this container already queried, fed the SAME
  // collapse state driving the on-screen tree (mapped into geometry's
  // row-id shape via `toGeometryCollapsedIds`, above) — full parity with the
  // old engine, where `collapsed` drove both the live tree AND the export
  // input. `Row.task` carries the full `Task` object unfiltered, so baseline
  // fields (baselineStartDate/baselineDueDate) already ride along for
  // whenever the export layer wants them — it doesn't reference them today
  // (verified: neither exportExcel.ts nor exportPdf.ts read baseline*
  // fields at all, locked or not), so there's nothing to wire up here beyond
  // not filtering the Task object down.
  //
  // `allRows`/`allDateRange` (renamed from `exportRows`/`exportDateRange` in
  // Task 8's fix pass) now feed TWO consumers: the export registration
  // effect below, AND the initial-view-fit effect (Finding #1,
  // task-b8-report.md) — `rowsDateRange` scans every row including
  // collapsed section headers (their start/end is computed via `rangeFor`
  // BEFORE geometry.ts's collapse early-return, geometry.ts:374-392), so
  // `allDateRange` is collapse-independent and correctly reflects the
  // FULL project's task span regardless of `collapsedGroups` — exactly the
  // semantics both consumers need.
  const exportCollapsed = useMemo(
    () => toGeometryCollapsedIds(collapsedGroups),
    [collapsedGroups],
  );
  const allRows = useMemo<Row[]>(
    () => buildRows({ tasks, sections, collapsed: exportCollapsed }),
    [tasks, sections, exportCollapsed],
  );
  const allDateRange = useMemo(() => rowsDateRange(allRows), [allRows]);

  // Plan B Task 5 — drag/resize commit. `events` is a controlled prop (see
  // the removed comment this replaces), so nothing here needs to touch local
  // state to "revert" a rejected gesture: on `false` the mutation never
  // fires, the tasks-query cache never changes, and the next render's
  // `events` memo (still derived from that unchanged cache) is what the
  // engine paints — that IS the revert. `eventPatch` (adapter.ts) converts
  // ReUI's exclusive `end` back to Solvro's inclusive `dueDate`.
  const handleEventUpdate = useCallback(
    (update: GanttProposedUpdate<Task>): GanttUpdateResult => {
      // Rollup pills (`section-rollup-*`, buildRollupEvents) are `readOnly:
      // true`, which gantt-types.tsx:97/gantt-bar already excludes from
      // drag/resize gestures entirely; they also carry no `data`, so
      // eventPatch's `!task` branch below would reject them a second time
      // even if a gesture somehow reached here. This id check is a third,
      // belt-and-suspenders layer — not what's actually doing the work.
      if (!canEdit || update.event.id.startsWith("section-rollup-")) return false;
      const patch = eventPatch(update);
      if (!patch) return false;
      setActionError(null);
      updateTask.mutate(patch, {
        onError: (err) => {
          setActionError(err instanceof ApiError ? err.message : "Could not update task dates.");
        },
      });
      return true;
    },
    [canEdit, updateTask],
  );

  // Plan B Task 5 — tree-row reorder commit. Mirrors GanttFrame.tsx:420-569's
  // `handleDragEnd` drop semantics (the OLD engine's constraints ARE the
  // spec) onto ReUI's single `{resourceId, parentId, index}` proposal shape.
  // Returns `false` to reject; per gantt.tsx:127 the real contract is
  // `void | false` (never `true` — unlike onEventUpdate's GanttUpdateResult,
  // there is no accept-with-adjustment form here).
  const handleResourceReorder = useCallback(
    (proposal: GanttResourceReorder): void | false => {
      if (!canEdit) return false;
      const { resourceId, parentId, index } = proposal;

      // ---- Section-group reorder (root level only) ----
      if (resourceId.startsWith("section-")) {
        // The "(No section)" pseudo-group has no backing Section row — old
        // engine only starts a section drag when `sectionId !== null`
        // (GanttFrame.tsx:539).
        if (resourceId === sectionNodeId(null)) return false;
        // Sections never nest under a task (GanttFrame.tsx:542: dropping a
        // section onto the pseudo group is rejected; dropping it under a
        // task isn't even representable in the old engine's flat section
        // list at all).
        if (parentId !== null) return false;

        // Re-derive the desired root order from the CURRENT (pre-drag) root
        // list — same shape `resources` already is (sections, then the
        // pseudo group last if present) — splice the move in at `index`,
        // then patch every REAL section whose position actually changed.
        // Mirrors GanttFrame.tsx:544-559's ordered/filtered/splice + diffed
        // Promise.all of useUpdateSection calls.
        const currentRootIds = resources.map((r) => r.id);
        const others = currentRootIds.filter((id) => id !== resourceId);
        const clamped = Math.max(0, Math.min(index, others.length));
        const nextRootOrder = [...others];
        nextRootOrder.splice(clamped, 0, resourceId);

        const patches = nextRootOrder
          .filter((id) => id !== sectionNodeId(null))
          .map((id, i) => ({ id: Number(id.slice("section-".length)), position: i }))
          .filter(({ id, position }) => sections.find((s) => s.id === id)?.position !== position);

        if (patches.length === 0) return false; // no-op — nothing actually moved
        setActionError(null);
        patches.forEach(({ id, position }) =>
          updateSection.mutate(
            { id, patch: { position } },
            {
              onError: (err) => {
                setActionError(err instanceof ApiError ? err.message : "Could not reorder sections.");
              },
            },
          ),
        );
        return;
      }

      // ---- Task-level reorder ----
      const taskId = parseTaskId(resourceId);
      if (taskId === null) return false;
      const moved = taskById.get(taskId);
      if (!moved) return false;

      if (moved.parentTaskId !== null) {
        // Subtask: reorder WITHIN its parent only — no re-parent via row
        // drags (GanttFrame.tsx:474-495: "Ignore drops outside the sibling
        // checklist"). ReUI's `index` already counts only OTHER same-parent
        // rows above the drop point (gantt-view.tsx's `propose()`), which is
        // exactly the backend's insertAt convention — no extra math needed,
        // unlike the top-level case below.
        if (parentId !== taskNodeId(moved.parentTaskId)) return false;
        if (index === moved.position) return false; // no-op
        setActionError(null);
        updateTask.mutate(
          { id: taskId, patch: { position: index } },
          {
            onError: (err) => {
              setActionError(err instanceof ApiError ? err.message : "Could not reorder subtask.");
            },
          },
        );
        return;
      }

      // Top-level task: must land under a section group (real or the "(No
      // section)" pseudo group), never under a task node — promoting a
      // top-level task into a subtask (or vice versa) via drag isn't
      // supported by the old engine's row-drag affordance.
      if (parentId === null || parseTaskId(parentId) !== null) return false;
      const targetSectionId =
        parentId === sectionNodeId(null) ? null : Number(parentId.slice("section-".length));

      // `position` is one GLOBAL dense index across every top-level task in
      // the project (CLAUDE.md: "one canonical manual order"; backend's
      // sibling key for parentTaskId===null is project-wide, not
      // per-section — taskOrdering.ts:17-19). Unifies GanttFrame's two old
      // drop paths — the row-target case (:431-471, arbitrary same/cross
      // -section position via a specific target row) and the
      // section-target case (:500-536, always append at the target
      // section's block end) — into one index-based computation, since
      // ReUI's `index` gives the precise slot in EITHER case.
      const topLevelOrdered = tasks
        .filter((t) => t.parentTaskId === null)
        .sort((a, b) => a.position - b.position || a.id - b.id);
      const others = topLevelOrdered.filter((t) => t.id !== taskId);
      const targetSiblings = others.filter((t) => t.sectionId === targetSectionId);
      const crossSection = targetSectionId !== moved.sectionId;

      let position: number | undefined;
      if (targetSiblings.length === 0) {
        // No other task in the target section — GanttFrame.tsx:529's `last`
        // undefined branch: omit position entirely (appends at the global
        // end; harmless, since display groups by section anyway).
        position = undefined;
      } else if (index >= targetSiblings.length) {
        const last = targetSiblings[targetSiblings.length - 1];
        position = others.findIndex((t) => t.id === last.id) + 1;
      } else {
        const before = targetSiblings[index];
        position = others.findIndex((t) => t.id === before.id);
      }

      if (!crossSection && (position === undefined || position === moved.position)) {
        return false; // no-op — same section, same slot (or nothing to reorder against)
      }

      const patch: { sectionId?: number | null; position?: number } = {};
      if (crossSection) patch.sectionId = targetSectionId;
      if (position !== undefined) patch.position = position;
      setActionError(null);
      updateTask.mutate(
        { id: taskId, patch },
        {
          onError: (err) => {
            setActionError(err instanceof ApiError ? err.message : "Could not move task.");
          },
        },
      );
      return;
    },
    [canEdit, resources, sections, tasks, taskById, updateTask, updateSection],
  );

  // Plan B Task 6 — connector create/delete, wired into GanttOverlay as
  // plain callback props (it holds no React Query hooks of its own). Mirrors
  // GanttFrame.tsx:308-322's handleDeleteDependency and the createDep.mutate
  // call inside its handleConnectStart (:268-288) — same error surfacing via
  // the shared `actionError` banner.
  const handleCreateDependency = useCallback(
    (input: CreateDependencyInput) => {
      setActionError(null);
      createDependency.mutate(input, {
        onError: (err) => {
          setActionError(err instanceof ApiError ? err.message : "Could not create dependency.");
        },
      });
    },
    [createDependency],
  );

  const handleDeleteDependency = useCallback(
    (id: number) => {
      setActionError(null);
      deleteDependency.mutate(id, {
        onError: (err) => {
          setActionError(err instanceof ApiError ? err.message : "Could not delete dependency.");
        },
      });
    },
    [deleteDependency],
  );

  const handleUpdateDates = useCallback(
    (taskId: number, startISO: string | null, dueISO: string | null) => {
      setActionError(null);
      updateTask.mutate(
        { id: taskId, patch: { startDate: startISO, dueDate: dueISO } },
        {
          onError: (err) => {
            setActionError(err instanceof ApiError ? err.message : "Could not update dates.");
          },
        },
      );
    },
    [updateTask],
  );

  const handleSetSectionColor = useCallback(
    (sectionId: number, color: string) => {
      updateSection.mutate({ id: sectionId, patch: { color } });
    },
    [updateSection],
  );

  // T5 (gantt visual refresh) — row menu's Delete action, fired from the
  // ConfirmModal below. Mirrors TaskPanel.tsx:190-201's handleDelete (same
  // useDeleteTask hook, same close-on-either-outcome shape) rather than
  // TaskFormModal.tsx's own bare-window.confirm delete path.
  const handleConfirmDeleteTask = useCallback(async () => {
    if (!deleteTarget) return;
    setActionError(null);
    try {
      await deleteTask.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete task.");
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteTask]);

  // T2 fix round (gantt visual refresh) — hoisted once per render (the day
  // string is identical for every row in a single render pass), rather than
  // recomputed once per row inside TaskDatesCell. Same pattern as
  // `pages/views/ProjectTimeline.tsx`'s own `todayDay` hoist.
  const todayDay = dateToDay(new Date());

  // Tree-pane inline editors, ported into ReUI's GanttColumn contract —
  // GanttListRow.tsx:240-270 (dates popover) and :151-194 (section color
  // popover); see TreeCells.tsx for the ported bodies. "Dates" renders only
  // on task nodes (parseTaskId !== null); the color swatch only on real
  // section groups (excludes the "(No section)" pseudo-group, matching
  // GanttListRow's `row.sectionId === null` guard on its color button).
  //
  // "status" uses the same task-node guard as "dates" (blank on section/
  // pseudo-group rows), placed BEFORE the pre-existing "dates"/"color"
  // columns — closer to the name, matching the Height reference. "dates"
  // keeps its full range + inline editor and additionally carries the
  // overdue treatment (red + bold + sr-only cue) via `todayDay`.
  const columns = useMemo<GanttColumn[]>(() => {
    const sectionColors = resolveSectionColors(sections);
    return [
      {
        id: "status",
        title: "Status",
        width: TREE_STATUS_COLUMN_WIDTH,
        render: (ctx) => {
          const taskId = parseTaskId(ctx.resource.id);
          if (taskId === null) return null;
          const task = taskById.get(taskId);
          if (!task) return null;
          return <TaskStatusCell task={task} />;
        },
      },
      {
        id: "dates",
        title: "Dates",
        width: TREE_DATES_COLUMN_WIDTH,
        align: "end",
        render: (ctx) => {
          const taskId = parseTaskId(ctx.resource.id);
          if (taskId === null) return null;
          const task = taskById.get(taskId);
          if (!task) return null;
          return (
            <TaskDatesCell
              task={task}
              canEdit={canEdit}
              onSave={handleUpdateDates}
              todayDay={todayDay}
            />
          );
        },
      },
      {
        id: "color",
        title: "",
        width: TREE_COLOR_COLUMN_WIDTH,
        align: "center",
        render: (ctx) => {
          if (ctx.resource.id === sectionNodeId(null) || !ctx.resource.id.startsWith("section-")) {
            return null;
          }
          const sectionId = Number(ctx.resource.id.slice("section-".length));
          if (!sectionColors.has(sectionId)) return null;
          return (
            <SectionColorCell
              sectionId={sectionId}
              color={sectionColors.get(sectionId) ?? DEFAULT_SECTION_COLOR}
              canEdit={canEdit}
              onPick={handleSetSectionColor}
            />
          );
        },
      },
    ];
  }, [sections, taskById, canEdit, handleUpdateDates, handleSetSectionColor, todayDay]);

  // Plan B Task 7 — register Excel/PDF export handlers in the shared context
  // (`GanttExportProvider`, mounted by ProjectDetail.tsx around the whole
  // route Outlet) so both this toolbar's own Export button AND the
  // RightSidebar's "Export schedule" section (mounted as a sibling, not a
  // child, of this component) can trigger the same handlers. Ported from
  // GanttFrame.tsx:597-684 — `exportGanttToExcel`/`exportGanttToPdf` and the
  // heavy libs they dynamically import (exceljs, jspdf, jspdf-autotable)
  // stay out of the main bundle via a dynamic import() of the wrapper
  // modules themselves, one level more aggressive than the old engine's
  // static top-level import (which relied solely on exceljs/jspdf being
  // dynamically imported *inside* those modules — still true, this just adds
  // a second layer of chunk separation for the wrapper modules too).
  const { handlers: exportHandlers, register } = useGanttExport();
  useEffect(() => {
    if (allRows.length === 0) {
      register(null);
      return;
    }
    // Excel/PDF export uses a tight ±7-day window around the actual task
    // range, not some padded chart window — otherwise the date grid is
    // dominated by empty columns. With no dated tasks (allDateRange null)
    // the same tight window is anchored on today, resolved at export time so
    // a tab left open across day boundaries doesn't pin a stale anchor.
    const exportWindow = () => {
      const anchor = startOfDay(new Date());
      return {
        start: startOfDay(addDays(allDateRange ? allDateRange.min : anchor, -7)),
        end: startOfDay(addDays(allDateRange ? allDateRange.max : anchor, 7)),
      };
    };
    register({
      excel: async () => {
        try {
          const { start, end } = exportWindow();
          const { exportGanttToExcel } = await import("@/lib/gantt/exportExcel");
          await exportGanttToExcel({
            projectName,
            rows: allRows,
            chartStart: start,
            chartEnd: end,
            holidays,
            colorBy,
            epics,
          });
        } catch (err) {
          setActionError(err instanceof Error ? err.message : "Excel export failed.");
          throw err;
        }
      },
      pdf: async () => {
        try {
          const { start, end } = exportWindow();
          const { exportGanttToPdf } = await import("@/lib/gantt/exportPdf");
          await exportGanttToPdf({
            projectName,
            rows: allRows,
            exportStart: start,
            exportEnd: end,
            holidays,
            colorBy,
            // F4 (2026-07-25) — dependency connectors now render in the PDF
            // too, so the export needs the same dependency data the live
            // overlay already fetches (GanttOverlay.tsx's props). Baseline
            // ghosts were also added in that pass but removed per user
            // direction the same day — PDF export never draws them,
            // regardless of whether the project's baseline is locked; the
            // on-screen `showBaseline` toggle and its ghosts are unaffected.
            dependencies,
          });
        } catch (err) {
          setActionError(err instanceof Error ? err.message : "PDF export failed.");
          throw err;
        }
      },
      pdfTab: async (win) => {
        try {
          const { start, end } = exportWindow();
          const { exportGanttToPdf } = await import("@/lib/gantt/exportPdf");
          await exportGanttToPdf({
            projectName,
            rows: allRows,
            exportStart: start,
            exportEnd: end,
            holidays,
            colorBy,
            dependencies,
            tabWindow: win,
          });
        } catch (err) {
          setActionError(err instanceof Error ? err.message : "PDF view failed.");
          throw err;
        }
      },
    });
    return () => register(null);
  }, [register, projectName, allRows, allDateRange, holidays, colorBy, dependencies, epics]);

  const runExport = useCallback(
    async (kind: "excel" | "pdf") => {
      if (!exportHandlers || exporting) return;
      setActionError(null);
      setExporting(kind);
      setExportMenuOpen(false);
      try {
        await exportHandlers[kind]();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Export failed.");
      } finally {
        setExporting(null);
      }
    },
    [exportHandlers, exporting],
  );

  const apiRef = useRef<GanttApi<Task> | null>(null);

  // Plan B Task 8 fix — Finding #1 (task-b8-report.md): the vendored engine
  // anchors its initial visible window on `new Date()` (gantt.tsx:342:
  // `date: initial.defaultDate ?? new Date()`) and never widens it to fit a
  // project's actual task dates — a project whose tasks fall outside that
  // window opened to a completely empty timeline with no on-screen
  // affordance. (The window's SIZE at the anchor date depends on `scale` —
  // originally a single week at this component's then-default scale; after
  // Task 9's F3 pill remap the default "Week" pill is ReUI scale "month",
  // so the initial window is now ~1 month wide, only widening the margin
  // for error here.) The old hand-rolled engine derived its chart window
  // from the tasks' own min/max dates (geometry.ts's
  // `computeChartStart`/`computeChartEnd`), so this was a real regression,
  // not a hand-rolled-engine parity gap.
  //
  // Rejected approach: passing a computed `defaultDate` prop to `<Gantt>`.
  // Verified by reading `createGanttStore` (gantt.tsx:331-343) that
  // `defaultDate` is consumed ONCE, inside a lazy `useState(() =>
  // createGanttStore(options))` initializer (gantt.tsx:844) — a later
  // render's different `defaultDate` value is silently ignored. Since
  // `tasks` loads asynchronously (React Query) and can ALSO change out from
  // under an already-mounted `<Gantt>` on a warm-cache project switch
  // (`SolvroGantt` itself doesn't remount per `projectId`), a mount-time-only
  // prop can't reliably reflect the right window.
  //
  // Chosen approach: `apiRef.current?.goTo(date)` (gantt.tsx:569 — the SAME
  // `setField("date", ...)` path `next`/`prev`/`today` use, already proven
  // by this file's own "Today" button above) re-anchors the visible window
  // live, no remount needed. Fires once per `projectId`, guarded by
  // `fitProjectIdRef` — mirrors the old engine's own one-shot
  // auto-scroll-to-today effect (GanttFrame.tsx:703-720, `didInitialScrollRef`)
  // so it doesn't fight the user's own navigation on every unrelated
  // re-render (a drag-reschedule invalidating the tasks query must NOT snap
  // the view back). `apiRef.current` is populated by <Gantt>'s own mount
  // effect (gantt.tsx:1646-1654), which — as a CHILD of this component —
  // commits before this effect on the very same render <Gantt> first mounts
  // (React's child-then-parent effect ordering), so the null-guard below is
  // defensive, not expected to fire; if it somehow did, `fitProjectIdRef`
  // is deliberately NOT marked done in that branch, so a later render
  // retries instead of permanently skipping the fit.
  //
  // Fit target: today, if it falls within the project's task date range
  // (old-engine parity — "today" is still the natural anchor for an
  // in-progress project); otherwise the earliest task date, so a fully
  // past- or future-dated project opens on its own data instead of an
  // empty "today" window. `allDateRange` (above) is what the export effect
  // also uses — collapse-independent, always the full project span.
  const fitProjectIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (isLoading || resources.length === 0) return;
    if (fitProjectIdRef.current === projectId) return;
    const api = apiRef.current;
    if (!api) return;
    fitProjectIdRef.current = projectId;
    const today = startOfDay(new Date());
    const fitDate =
      !allDateRange || (today >= allDateRange.min && today <= allDateRange.max)
        ? today
        : allDateRange.min;
    api.goTo(fitDate);
  }, [isLoading, resources.length, projectId, allDateRange]);

  const legend = useMemo(() => legendEntries(colorBy, sections), [colorBy, sections]);

  const handleAddSection = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = newSectionName.trim();
      if (!name) return;
      setActionError(null);
      try {
        await createSection.mutateAsync({ name });
        setNewSectionName("");
        setAddingSection(false);
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : "Could not create section.");
      }
    },
    [createSection, newSectionName],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest"
      data-testid="solvro-gantt"
      aria-label={`${projectName} Gantt chart`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant bg-surface-container-lowest px-3 py-1.5">
        {/* Zoom pill group — Day / Week / Month / Quarter, active segment solid
            green. The rest of the toolbar below mirrors this container+item
            +hover treatment; the focus classes here are the app-standard set
            the mirrored groups also carry. */}
        <div className="inline-flex overflow-hidden rounded-md bg-surface-container-low p-0.5">
          {SCALES.map((s) => (
            <button
              key={s.mode}
              type="button"
              onClick={() => setScale(s.mode)}
              className={cn(
                TOOLBAR_ITEM_HEIGHT,
                "inline-flex items-center rounded-sm px-2.5 font-display text-[11.5px] font-semibold tracking-wide outline-hidden transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
                s.mode === scale
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {canEdit && (
          <>
            <span className="mx-1 h-4 w-px bg-outline-variant" aria-hidden />
            {/* T6 — segmented shell mirrored from the scale-pill group above. */}
            <div className="inline-flex overflow-hidden rounded-md bg-surface-container-low p-0.5">
              <button
                type="button"
                onClick={() => onCreateTaskOpen(null)}
                className={cn(
                  TOOLBAR_ITEM_HEIGHT,
                  "inline-flex items-center gap-1 rounded-sm px-2.5 font-display text-[11.5px] font-medium text-on-surface outline-hidden transition-colors hover:text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
                )}
              >
                <span className="material-symbols-outlined text-[15px]">add</span>
                Task
              </button>
              <button
                type="button"
                onClick={() => setAddingSection(true)}
                className={cn(
                  TOOLBAR_ITEM_HEIGHT,
                  "inline-flex items-center gap-1 rounded-sm px-2.5 font-display text-[11.5px] font-medium text-on-surface-variant outline-hidden transition-colors hover:text-on-surface focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
                )}
              >
                <span className="material-symbols-outlined text-[15px]">add</span>
                Section
              </button>
            </div>
          </>
        )}

        <span className="ml-2 hidden font-mono text-[12px] text-on-surface-variant lg:inline">
          {tasks.filter((t) => t.startDate || t.dueDate).length} dated · {sections.length} sections
        </span>

        {/* `flex-1 min-w-0` + `flex-wrap` (2026-08-31): the cluster takes
            whatever row space is left (flex-basis 0, so it can never
            line-break as a block) and folds its groups one at a time,
            `justify-end` keeping them right-aligned — previously it dropped
            to a second row whole, leaving the space under the zoom pills
            empty. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {/* T6 — Today/prev/next merged into one segmented pill (mirrors the
              scale-pill container above); the period title stays plain text
              (per the plan's "text elements ... stay text"), positioned right
              after the pill so it still reads as part of the same cluster.
              T1 note retained: prev/next step by apiRef's own stepGanttDate
              at the CURRENT `scale`, same anchor path Today already drives;
              the title follows via the GanttNavTitleSync bridge child (below,
              inside <Gantt>) lifting useGanttNavigation()'s live title up. */}
          <div className="inline-flex overflow-hidden rounded-md bg-surface-container-low p-0.5">
            <button
              type="button"
              onClick={() => apiRef.current?.today()}
              disabled={resources.length === 0}
              className={cn(
                TOOLBAR_ITEM_HEIGHT,
                "inline-flex items-center gap-1 rounded-sm px-2.5 font-display text-[11.5px] font-medium text-on-surface-variant outline-hidden transition-colors hover:text-on-surface focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
              )}
            >
              <span className="material-symbols-outlined text-[15px]">today</span>
              Today
            </button>
            <button
              type="button"
              onClick={() => apiRef.current?.prev()}
              disabled={resources.length === 0}
              aria-label="Previous period"
              className={cn(
                TOOLBAR_ITEM_HEIGHT,
                "inline-flex w-7 items-center justify-center rounded-sm text-on-surface-variant outline-hidden transition-colors hover:text-on-surface focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
              )}
            >
              <span className="material-symbols-outlined text-[15px]">chevron_left</span>
            </button>
            <button
              type="button"
              onClick={() => apiRef.current?.next()}
              disabled={resources.length === 0}
              aria-label="Next period"
              className={cn(
                TOOLBAR_ITEM_HEIGHT,
                "inline-flex w-7 items-center justify-center rounded-sm text-on-surface-variant outline-hidden transition-colors hover:text-on-surface focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
              )}
            >
              <span className="material-symbols-outlined text-[15px]">chevron_right</span>
            </button>
          </div>
          {/* resources.length gate: <Gantt> (and the GanttNavTitleSync bridge
              child inside it) only mounts once there's data, so a stale
              title from a previously open project must not linger next to
              the disabled nav above. */}
          {navTitle && resources.length > 0 && (
            <span
              className="min-w-0 truncate font-display text-[11.5px] font-semibold text-on-surface"
              aria-live="polite"
            >
              {navTitle}
            </span>
          )}
          {/* Baseline toggle. The Lock/Reset action moved to the Context
              panel (RightSidebar.tsx, 2026-08-31) — a once-per-project step
              that was costing the toolbar ~105px. The active state mirrors
              the scale-pill's exact active treatment (bg-primary/
              text-on-primary), with aria-pressed carrying it semantically. */}
          <div className="inline-flex overflow-hidden rounded-md bg-surface-container-low p-0.5">
            <button
              type="button"
              onClick={() => setShowBaseline((v) => !v)}
              aria-pressed={showBaseline}
              title={
                baselineLockedAt
                  ? `Baseline locked ${baselineLockedAtPretty}${baselineLockedBy ? ` by ${baselineLockedBy.username}` : ""}`
                  : "No baseline locked yet — lock one from the Context panel"
              }
              className={cn(
                TOOLBAR_ITEM_HEIGHT,
                "inline-flex items-center gap-1 rounded-sm px-2.5 font-display text-[11.5px] font-medium outline-hidden transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
                showBaseline
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              <span className="material-symbols-outlined text-[15px]">show_chart</span>
              Baseline
            </button>
          </div>
          {/* Color-by menu (2026-08-31): mode radios on top, the full color
              key below. Replaces the native <select> + inline legend — the
              legend grew with the section count (capped at 6 + "+N more")
              and was the main reason the toolbar wrapped to a second row.
              Radio items keep the menu open on pick (Base-UI RadioItem's
              closeOnClick default), so switching modes updates the key in
              place. The trigger shares the segmented shell and
              TOOLBAR_ITEM_HEIGHT of every other group; the `render` element
              carries all visual content (house pattern — see
              reui/gantt/gantt-nav.tsx). */}
          <DropdownMenu>
            <div className="inline-flex overflow-hidden rounded-md bg-surface-container-low p-0.5">
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      TOOLBAR_ITEM_HEIGHT,
                      "inline-flex items-center gap-1.5 rounded-sm pl-2.5 pr-1.5 font-display text-[11.5px] font-medium text-on-surface outline-hidden transition-colors hover:text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
                    )}
                  >
                    <span className="text-meta text-on-surface-variant">
                      Color by
                    </span>
                    {COLOR_BY_LABELS[colorBy]}
                    <span
                      className="material-symbols-outlined text-[16px] text-on-surface-variant"
                      aria-hidden="true"
                    >
                      expand_more
                    </span>
                  </button>
                }
              />
            </div>
            {/* positionerClassName, not className, carries the z-index
                (frontend/CLAUDE.md "Popover z-index"): the menu opens over
                the Gantt's sticky `z-30` axis header. Deliberately `z-50`,
                not the convention's `z-101`: that value exists for pickers
                that open INSIDE Modal.tsx's `z-100` layer; this menu never
                does, and must stay below it. `shadow-overlay!` +
                `bg-surface-container-lowest` put the popup on the app's one
                sanctioned shadow/surface pair (docs/DESIGN.md §4), matching
                the Export dropdown beside it — the `!` is needed because the
                vendored popup's `shadow-md` is a stock class twMerge doesn't
                fold against the custom token (same as DateRangeField.tsx). */}
            <DropdownMenuContent
              align="end"
              className="w-60 bg-surface-container-lowest shadow-overlay!"
              positionerClassName="z-50"
            >
              <DropdownMenuRadioGroup
                value={colorBy}
                onValueChange={(v) => setColorBy(v as ColorByMode)}
              >
                {COLOR_BY_MODES.map((mode) => (
                  <DropdownMenuRadioItem key={mode} value={mode} className="text-[12px]">
                    {COLOR_BY_LABELS[mode]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {/* Menu.Group (role="group") + its GroupLabel keep the
                  popup's `role="menu"` children valid for assistive
                  tech — plain divs inside a menu are skipped, and this
                  menu is now the only place the key exists.
                  Critical Path fix round (plan §3): the group used to be
                  gated on `legend.length > 0` (only "section" mode with
                  zero sections could ever hit that), which would have hidden
                  the new static Critical Path row too — "shown in every
                  mode" means unconditionally, so the group (and its
                  Key label) now always renders; only the per-mode `legend`
                  list inside it stays conditional. */}
              <DropdownMenuGroup aria-label="Color key">
                <DropdownMenuLabel className="pb-1 pt-1.5 text-label-caps uppercase text-on-surface-variant">
                  Key
                </DropdownMenuLabel>
                <div data-testid="gantt-legend" className="flex flex-col gap-1 px-2 pb-1.5">
                  {legend.map(([label, hex], i) => (
                    <span
                      key={`${colorBy}-${i}-${label}`}
                      title={label}
                      className="flex min-w-0 items-center gap-2 text-[12px] text-on-surface-variant"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: hex }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{label}</span>
                    </span>
                  ))}
                  {/* Critical Path mark (plan §3): one static LAST row,
                      shown in every Color-by mode — the mark is a ring/
                      glyph, never a fill, so it survives whichever mode's
                      fills are active rather than being one more fill entry
                      in the mode-specific list above. */}
                  <span
                    title={CRITICAL_PATH_LABEL}
                    className="flex min-w-0 items-center gap-2 text-[12px] text-on-surface-variant"
                  >
                    {/* Phase review: a 2px ring on this 8px box left only a 4px
                        hole and read as a filled square. A 1px ring keeps a 6px
                        transparent center, and the 8px box keeps the label
                        column aligned with the mode swatches above. */}
                    <span
                      className="h-2 w-2 shrink-0 rounded-[2px] ring-1 ring-inset ring-chip-violet-text"
                      aria-hidden="true"
                    />
                    <span className="truncate">{CRITICAL_PATH_LABEL}</span>
                  </span>
                </div>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Export (Excel/PDF) — ported from GanttFrame.tsx:882-910. Icon-only
              since 2026-08-31 (aria-label + title carry the name; the Context
              panel keeps the labelled Excel / PDF / View trio). T6 —
              the segmented shell wraps ONLY the trigger button, not the
              dropdown: the dropdown is `absolute top-full`, positioned
              BELOW the shell's bounds, so putting it inside an
              `overflow-hidden` sibling of the button (like the other groups)
              would silently clip it invisible. exportMenuRef stays on the
              outer `relative` div, which still contains both the shell and
              the dropdown, so the existing outside-click-to-close handler
              (below, via .contains()) is unaffected. */}
          <div className="relative" ref={exportMenuRef}>
            <div className="inline-flex overflow-hidden rounded-md bg-surface-container-low p-0.5">
              <button
                type="button"
                onClick={() => setExportMenuOpen((v) => !v)}
                disabled={!exportHandlers || exporting !== null}
                aria-label={exporting ? "Exporting…" : "Export"}
                title={exporting ? "Exporting…" : "Export"}
                className={cn(
                  TOOLBAR_ITEM_HEIGHT,
                  "inline-flex w-7 items-center justify-center rounded-sm text-on-surface-variant outline-hidden transition-colors hover:text-on-surface focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50",
                )}
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                  {exporting ? "hourglass_top" : "download"}
                </span>
              </button>
            </div>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-32 rounded-sm border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
                <button
                  type="button"
                  onClick={() => runExport("excel")}
                  className="block w-full px-3 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container-low"
                >
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => runExport("pdf")}
                  className="block w-full px-3 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container-low"
                >
                  PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {addingSection && (
        <form
          onSubmit={handleAddSection}
          className="flex items-center gap-2 border-b border-outline-variant bg-surface-container-low px-3 py-2"
        >
          <input
            autoFocus
            type="text"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder="Section name"
            maxLength={100}
            className="w-64 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs focus:border-primary focus:outline-hidden"
          />
          <button
            type="submit"
            disabled={createSection.isPending || !newSectionName.trim()}
            className="rounded-sm bg-primary px-2 py-1 font-display text-xs text-on-primary hover:bg-primary-container disabled:opacity-50 font-semibold"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingSection(false);
              setNewSectionName("");
            }}
            className="rounded-sm px-2 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancel
          </button>
        </form>
      )}

      {actionError && (
        <Alert variant="destructive" className="m-3">
          <AlertDescription className="text-xs">{actionError}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <TableSkeleton rows={8} columns={3} widths={["w-3/4", "w-16", "w-16"]} className="m-3" />
      )}
      {isError && (
        <Alert variant="destructive" className="m-3">
          <AlertDescription>Could not load tasks: {(error as Error).message}</AlertDescription>
        </Alert>
      )}
      {!isLoading && !isError && resources.length === 0 && (
        <div className="m-3 rounded-sm border border-dashed border-outline-variant p-12 text-center text-on-surface-variant">
          <p className="text-sm">
            No tasks or sections yet. Use + Task or + Section above to start building the plan.
          </p>
        </div>
      )}

      {!isLoading && !isError && resources.length > 0 && (
        <div ref={ganttContainerRef} className="min-h-0 flex-1">
          <Gantt<Task>
            apiRef={apiRef}
            events={events}
            resources={resources}
            scale={scale}
            onScaleChange={setScale}
            weekStartsOn={1}
            interactions={{ drag: canEdit, resize: canEdit, selectSlot: false }}
            // Accepted deviation (documented in CHANGELOG.md): the old engine
            // shaded weekends only at Day/Week zoom while holidays shaded at
            // every zoom (GanttColumnGrid.tsx:41-61). ReUI's offDays applies
            // uniformly across all zooms — weekendDays defaults to [0,6], so
            // both weekends and these explicit holiday dates now shade at
            // every scale.
            offDays={{ dates: holidays.map((h) => parseISO(h.date)) }}
            columns={columns}
            // Walkthrough F6 (2026-07-25) — draggable, persisted tree-pane
            // width via the engine's own built-in splitter (see the
            // TREE_WIDTH_STORAGE_KEY block above and `treePanel` memo).
            treePanel={treePanel}
            rowCheckboxes={false}
            // Engine's floating +/− zoom widget (bottom-right) stays default-on:
            // continuous 0.5–3× column-width zoom on top of the scale pills.
            // Its shadow is stripped in gantt-view.tsx (SOLVRO PATCH).

            // Plan B Task 7 (fix pass) — controlled collapse (gantt.tsx:1344-
            // 1348), fed straight through to the export effect above so
            // exports match on-screen collapse exactly like the old engine
            // did. Ids are resource-node ids (adapter.ts's sectionNodeId/
            // taskNodeId), mapped to geometry.ts's row-id shape via
            // toGeometryCollapsedIds before reaching buildRows().
            collapsedGroups={collapsedGroups}
            onCollapsedGroupsChange={setCollapsedGroups}
            // Plan B Task 4: renderEvent hands every bar's inner content to
            // SolvroBar; barLabel="inside" (already the engine default, made
            // explicit) disables ReUI's own width-threshold outside-label
            // flip so SolvroBar's measured-fit check is the only placement
            // decision in play — see SolvroBar.tsx's file header.
            renderEvent={(renderProps) => <SolvroBar {...renderProps} canEdit={canEdit} />}
            classNames={{ event: SOLVRO_EVENT_CLASSNAMES }}
            barLabel="inside"
            renderResourceLabel={({ resource }) => {
              const label = resource.id === sectionNodeId(null) ? "(No section)" : resource.title;
              // T2 (gantt visual refresh) — colored status dot before the
              // name, task rows only (`parseTaskId` returns null for
              // section/pseudo-group ids, same guard the "status"/"dates"
              // columns above use — dot stays blank on section rows).
              // Subtasks share the same `task-<id>` id shape as top-level
              // tasks, so they get the dot too, per this task's brief.
              const taskId = parseTaskId(resource.id);
              const task = taskId !== null ? taskById.get(taskId) : undefined;
              return (
                <>
                  {task && <TaskStatusDot status={task.status} />}
                  {/* Critical Path mark (plan §3) — glyph only, tight tree
                      column; the shared component carries the label as its
                      title/aria-label. `me-1.5` matches TaskStatusDot's own
                      gap (this row has no `gap`, review fix round: the
                      glyph sat flush against the title without it). */}
                  {task?.isCriticalPath && (
                    <CriticalPathMark variant="glyph" className="me-1.5 shrink-0" />
                  )}
                  {/* Walkthrough F6 (2026-07-25) — cheap hover affordance: a
                    native title tooltip surfaces the full name even before
                    the user discovers the splitter, and stays useful for
                    names that still overflow the widened column. */}
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                  {/* Fix round (T5) — user-requested visible row-menu
                    affordance: right-click alone was judged undiscoverable.
                    No vendored edit needed — this renders inside the same
                    `rowNode` the engine wraps in <ContextMenuTrigger>
                    (gantt-view.tsx:2791-2792), whose onContextMenu handler
                    is a plain React-bound listener on that DOM node
                    (confirmed in @base-ui/react's ContextMenuTrigger
                    source), so a synthetic, bubbling "contextmenu" event
                    dispatched from a descendant button reaches it exactly
                    like a real right-click would. `stopPropagation` here is
                    cheap insurance, not the primary gate — the row's own
                    onClick already ignores any `button` descendant
                    (gantt-view.tsx:2628-2629's `.closest("button, [role=
                    checkbox]")` guard), same pattern the drag-grip button
                    below relies on. Hover-reveal reuses the engine's own
                    drag-grip fade-in classes verbatim (`group-hover/
                    gantt-row`, gantt-view.tsx:2675) — no vendored edit
                    needed for that either, since this content already
                    renders inside the row wrapper carrying that group. */}
                  {canEdit && task && (
                    <button
                      type="button"
                      aria-label="Task actions"
                      className="text-on-surface-variant hover:text-on-surface ms-auto flex size-5 shrink-0 items-center justify-center rounded-sm outline-hidden opacity-0 transition-opacity group-hover/gantt-row:opacity-100 group-data-hover/gantt-row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/30 pointer-coarse:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        e.currentTarget.dispatchEvent(
                          new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            clientX: rect.left,
                            clientY: rect.bottom,
                          }),
                        );
                      }}
                    >
                      <span className="material-symbols-outlined text-sm" aria-hidden="true">
                        more_horiz
                      </span>
                    </button>
                  )}
                </>
              );
            }}
            // T5 (gantt visual refresh) — per-row "…" menu (Height-style:
            // Edit / Add subtask / Delete). `renderResourceMenu` is called
            // for EVERY row, including section/pseudo-group rows
            // (gantt-view.tsx:2607) — returning `null` there is what keeps
            // those rows menu-free (gantt-view.tsx:2789's `if (!menu) return
            // rowNode`), same `parseTaskId` guard the status/dates columns and
            // the status dot above already use. Passed as `undefined`
            // (rather than a function that internally checks `canEdit`)
            // when the user can't edit — same gating shape as
            // `onResourceReorder` below, so read-only users get no menu
            // affordance at all rather than an empty one.
            renderResourceMenu={
              canEdit
                ? (ctx) => {
                    const taskId = parseTaskId(ctx.resource.id);
                    if (taskId === null) return null;
                    const task = taskById.get(taskId);
                    if (!task) return null;
                    return (
                      <>
                        <ContextMenuItem className="text-xs" onClick={() => onEditTask(task)}>
                          <span
                            className="material-symbols-outlined text-sm text-on-surface-variant"
                            aria-hidden="true"
                          >
                            edit
                          </span>
                          Edit
                        </ContextMenuItem>
                        {/* Duplicate task — top-level rows AND
                          subtask rows, unlike "Add subtask" below which is
                          top-level only. Server-side copy: no optimistic
                          write, same invalidate-only shape as Delete. */}
                        <ContextMenuItem
                          className="text-xs"
                          disabled={duplicateTask.isPending && duplicateTask.variables === task.id}
                          onClick={() => {
                            setActionError(null);
                            duplicateTask.mutate(task.id, {
                              onError: (err) => {
                                setActionError(
                                  err instanceof ApiError
                                    ? err.message
                                    : "Could not duplicate the task.",
                                );
                              },
                            });
                          }}
                        >
                          <span
                            className="material-symbols-outlined text-sm text-on-surface-variant"
                            aria-hidden="true"
                          >
                            content_copy
                          </span>
                          Duplicate
                        </ContextMenuItem>
                        {/* Critical Path mark (plan §3): toggles the manual
                          flag via the same optimistic single-field patch
                          the panel toggle and other row actions use
                          (useUpdateTask — see queries.ts's UpdateTaskInput
                          spread, §4). `canEdit` only — this menu already is. */}
                        <ContextMenuItem
                          className="text-xs"
                          onClick={() =>
                            updateTask.mutate(
                              {
                                id: task.id,
                                patch: { isCriticalPath: !task.isCriticalPath },
                              },
                              {
                                onError: (err) => {
                                  setActionError(
                                    err instanceof ApiError
                                      ? err.message
                                      : "Could not update the Critical Path mark.",
                                  );
                                },
                              },
                            )
                          }
                        >
                          <span
                            className="material-symbols-outlined text-sm text-on-surface-variant"
                            aria-hidden="true"
                          >
                            {CRITICAL_PATH_GLYPH}
                          </span>
                          {task.isCriticalPath
                            ? `Remove from ${CRITICAL_PATH_LABEL}`
                            : `Mark as ${CRITICAL_PATH_LABEL}`}
                        </ContextMenuItem>
                        {/* Fix round — the removed comment here claimed
                          TaskFormModal's own "Parent" dropdown "only lists
                          top-level tasks", which is false in CREATE mode:
                          TaskFormModal.tsx:129-131's `possibleParents` filter
                          short-circuits to EVERY project task there
                          (`!editingTask` is `true`, so the right side of the
                          `||` — the `parentTaskId === null` check — never
                          runs; only EDIT mode enforces it). The real
                          authority for this guard is the BACKEND:
                          assertValidParent (backend/src/lib/
                          taskOrdering.ts:134-140) rejects a parent that
                          itself has a parent (max depth 1), reached from
                          this create call via routes/projects.ts:362.
                          Hiding "Add subtask" on subtask rows keeps this
                          menu from offering an action that would 400 — the
                          create-mode dropdown bug above is real but out of
                          this task's scope (flagged for the phase review,
                          not fixed here). */}
                        {task.parentTaskId === null && (
                          <ContextMenuItem
                            className="text-xs"
                            onClick={() => onCreateTaskOpen(task.sectionId, task.id)}
                          >
                            <span
                              className="material-symbols-outlined text-sm text-on-surface-variant"
                              aria-hidden="true"
                            >
                              playlist_add
                            </span>
                            Add subtask
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-xs"
                          variant="destructive"
                          onClick={() => setDeleteTarget(task)}
                        >
                          {/* No explicit color class — inherits
                            ContextMenuItem's `data-[variant=destructive]:
                            text-destructive` via normal CSS color
                            inheritance (that rule targets the item's own
                            text color, not just `svg` children like the
                            component's other muting rules do). */}
                          <span className="material-symbols-outlined text-sm" aria-hidden="true">
                            delete
                          </span>
                          Delete
                        </ContextMenuItem>
                      </>
                    );
                  }
                : undefined
            }
            onEventClick={(occurrence) => {
              const task = occurrence.event.data;
              if (task) onEditTask(task);
            }}
            onResourceClick={(ctx) => {
              const taskId = parseTaskId(ctx.resource.id);
              if (taskId === null) return;
              const task = taskById.get(taskId);
              if (task) onEditTask(task);
            }}
            className="h-full"
            // Plan B Task 5: commit pipeline. onEventUpdate is additionally
            // gated by `interactions.drag/resize` above (canEdit-driven), so
            // the handler's own `!canEdit` check is redundant there —
            // cheap insurance, not the primary gate. onResourceReorder has
            // no separate interactions flag: passing it unconditionally
            // would render the row-drag grip (gantt-view.tsx:1591 →
            // `reorderEnabled = !!settings.onResourceReorder`, wired to
            // `onGripPointerDown` at :1888, rendered at :2659-2670) for
            // read-only users too, so `undefined` here is what actually
            // hides it — the handler's internal check is the fallback,
            // not this.
            onEventUpdate={handleEventUpdate}
            onResourceReorder={canEdit ? handleResourceReorder : undefined}
          >
            <GanttView />
            {/* T1 (fix round) — see GanttNavTitleSync's doc comment above. */}
            <GanttNavTitleSync onTitleChange={setNavTitle} />
          </Gantt>
          {/* Plan B Task 6 — chart-space overlay (dependency connectors,
              drag-create, baselines). A sibling of <Gantt>, not a child of
              it: it needs no gantt-context hooks, only the DOM the vendored
              tree already committed, reached via containerRef + a portal. */}
          <GanttOverlay
            containerRef={ganttContainerRef}
            dependencies={dependencies}
            events={events}
            showBaseline={showBaseline}
            canEdit={canEdit}
            onCreate={handleCreateDependency}
            onDelete={handleDeleteDependency}
          />
        </div>
      )}

      {/* T5 (gantt visual refresh) — row menu's Delete confirmation.
          Subtask count mirrors TaskPanel.tsx's ConfirmModal body verbatim
          (same cascade-delete warning copy). */}
      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDeleteTask}
        title="Delete task"
        body={
          <>
            Delete task &quot;{deleteTarget?.title}&quot;? This cannot be undone.
            {deleteTarget &&
              tasks.filter((t) => t.parentTaskId === deleteTarget.id).length > 0 && (
                <>
                  <br />
                  <br />
                  This task has{" "}
                  {tasks.filter((t) => t.parentTaskId === deleteTarget.id).length} subtask(s)
                  which will also be deleted.
                </>
              )}
          </>
        }
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteTask.isPending}
      />

    </div>
  );
}
