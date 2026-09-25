import { addDays, parseISODate, startOfDay, type Row } from "./geometry";
import {
  CRITICAL_PATH_HEX,
  HOLIDAY_HEX,
  PRIORITY_BORDER_HEX,
  WEEKEND_HEX,
  barFillHex,
  type ColorByMode,
} from "./palette";
import type { Epic, Holiday } from "@/lib/queries";

interface ExportExcelOpts {
  projectName: string;
  rows: Row[];
  chartStart: Date;
  chartEnd: Date;
  holidays: Holiday[];
  colorBy: ColorByMode;
  // Epics (docs/archive/plans/epics-spec.md §6 last bullet, §7 T7): the Tasks
  // sheet's "Epic" column needs epic titles, which don't live on `Row` or
  // `Task` (only `Task.epicId` does) — the caller passes the project's
  // epics the same way it passes `holidays`. Optional + defaults to `[]` so
  // a caller that hasn't wired `useProjectEpics` through yet still compiles
  // and just renders an empty Epic column.
  epics?: Epic[];
}

const STATUS_LABEL: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

// Strip "#" and uppercase; ExcelJS ARGB takes 8 chars (alpha + RGB).
function argb(hex: string, alpha = "FF"): string {
  return `${alpha}${hex.replace(/^#/, "").toUpperCase()}`;
}

/**
 * Builds the Tasks sheet's column defs + per-row cell values — "Section /
 * Epic / Title / Status / Priority / [Critical Path] / Start / Due". Pure
 * and synchronous (no ExcelJS workbook needed) so exportExcel.test.ts can
 * assert on the sheet's actual input directly — mirrors exportPdf.ts's
 * `buildTaskTable`.
 *
 * Critical Path column (plan §3, empty-project rule): added only when at
 * least one row in `rows` carries the mark — a project with no marked task
 * gets the exact same 6-column sheet as before the mark shipped.
 *
 * Epic column (docs/archive/plans/epics-spec.md §6 last bullet, §7 T7): always
 * present, right after Section. `Task.epicId` is only ever set on a
 * top-level task (§4) — a subtask row inherits its parent's epic for
 * display by walking `parentRowId` back to the parent task row, the same
 * pattern `sectionLookup` already uses for the Section column.
 */
export function buildTasksSheet(rows: Row[], epics: Epic[] = []): {
  columns: Array<{ header: string; key: string; width: number }>;
  rows: Array<Record<string, string>>;
  hasCriticalPath: boolean;
} {
  const taskRows = rows.filter((r) => r.kind === "task" || r.kind === "subtask");
  const sectionLookup = new Map<string, string>();
  for (const r of rows) {
    if (r.kind === "section") sectionLookup.set(r.id, r.name);
  }
  const epicTitleById = new Map<number, string>(epics.map((e) => [e.id, e.title]));
  const epicIdByTaskRowId = new Map<string, number | null>();
  for (const r of rows) {
    if (r.kind === "task") epicIdByTaskRowId.set(r.id, r.task?.epicId ?? null);
  }
  const hasCriticalPath = taskRows.some((r) => r.isCriticalPath);

  const columns = [
    { header: "Section", key: "section", width: 24 },
    { header: "Epic", key: "epic", width: 20 },
    { header: "Title", key: "title", width: 48 },
    { header: "Status", key: "status", width: 14 },
    { header: "Priority", key: "priority", width: 12 },
    ...(hasCriticalPath
      ? [{ header: "Critical Path", key: "criticalPath", width: 14 }]
      : []),
    { header: "Start", key: "start", width: 12 },
    { header: "Due", key: "due", width: 12 },
  ];

  const sheetRows = taskRows.map((r) => {
    const t = r.task;
    const sectionName = r.parentRowId ? sectionLookup.get(r.parentRowId) ?? "" : "";
    const indent = r.kind === "subtask" ? "  └ " : "";
    const epicId = r.kind === "subtask"
      ? (r.parentRowId ? epicIdByTaskRowId.get(r.parentRowId) ?? null : null)
      : t?.epicId ?? null;
    const epicTitle = epicId !== null ? epicTitleById.get(epicId) ?? "" : "";
    return {
      section: sectionName,
      epic: epicTitle,
      title: `${indent}${r.name}`,
      status: t ? STATUS_LABEL[t.status] ?? t.status : "",
      priority: t?.priority ?? "",
      ...(hasCriticalPath ? { criticalPath: r.isCriticalPath ? "Yes" : "" } : {}),
      start: t?.startDate ? fmtIsoDate(parseISODate(t.startDate)) : "",
      due: t?.dueDate ? fmtIsoDate(parseISODate(t.dueDate)) : "",
    };
  });

  return { columns, rows: sheetRows, hasCriticalPath };
}

export async function exportGanttToExcel(opts: ExportExcelOpts): Promise<void> {
  const { projectName, rows, chartStart, chartEnd, holidays, colorBy, epics = [] } = opts;
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Solvro";
  workbook.created = new Date();

  // ────────── Sheet 1: Tasks ──────────
  const { columns: taskColumns, rows: taskSheetRows } = buildTasksSheet(rows, epics);
  // Zipped 1:1 with `taskSheetRows` (both filter `rows` the same way, see
  // buildTasksSheet) — only used here for the priority cell's fill/font,
  // which stays an ExcelJS-side concern rather than plain cell data.
  const taskRows = rows.filter((r) => r.kind === "task" || r.kind === "subtask");

  const tasksSheet = workbook.addWorksheet("Tasks");
  tasksSheet.columns = taskColumns;
  const headerRow = tasksSheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: argb("E2E8F0") },
  };
  headerRow.alignment = { vertical: "middle" };

  for (let i = 0; i < taskSheetRows.length; i++) {
    const priority = taskRows[i].task?.priority;
    const row = tasksSheet.addRow(taskSheetRows[i]);
    if (priority) {
      row.getCell("priority").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: argb(PRIORITY_BORDER_HEX[priority].replace(/^#/, "")) },
      };
      row.getCell("priority").font = {
        color: { argb: argb("FFFFFF") },
        bold: true,
      };
    }
  }
  tasksSheet.views = [{ state: "frozen", ySplit: 1 }];

  // ────────── Sheet 2: Gantt (date grid) ──────────
  const ganttSheet = workbook.addWorksheet("Gantt");

  // Build the day list from chartStart..chartEnd inclusive.
  const days: Date[] = [];
  let cur = startOfDay(chartStart);
  const last = startOfDay(chartEnd);
  while (cur <= last) {
    days.push(new Date(cur));
    cur = addDays(cur, 1);
  }

  const today = startOfDay(new Date());
  const holidayDates = new Set(holidays.map((h) => h.date));

  // Column widths: first col wide for task name, rest narrow per-day.
  const cols: Partial<import("exceljs").Column>[] = [
    { header: "Task", key: "name", width: 36 },
  ];
  for (let i = 0; i < days.length; i++) {
    cols.push({ key: `d${i}`, width: 3 });
  }
  ganttSheet.columns = cols;

  // Row 1: month headers (merged across each month run).
  // Row 2: day-of-month numbers.
  const monthRow = ganttSheet.getRow(1);
  const dayRow = ganttSheet.getRow(2);
  monthRow.getCell(1).value = projectName;
  monthRow.getCell(1).font = { bold: true, size: 12 };
  dayRow.getCell(1).value = "";
  dayRow.getCell(1).font = { bold: true };

  let runStartIdx = 0;
  let runMonth = -1;
  let runYear = -1;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const colIdx = i + 2; // +1 for header col, +1 for 1-based
    if (i === 0) {
      runMonth = d.getMonth();
      runYear = d.getFullYear();
      runStartIdx = colIdx;
    } else if (d.getMonth() !== runMonth || d.getFullYear() !== runYear) {
      // close out previous run
      const startCol = runStartIdx;
      const endCol = colIdx - 1;
      if (endCol > startCol) {
        ganttSheet.mergeCells(1, startCol, 1, endCol);
      }
      const cell = monthRow.getCell(startCol);
      cell.value = `${MONTHS_SHORT[runMonth]} ${runYear}`;
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true, size: 10 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: argb("F1F5F9") },
      };
      runMonth = d.getMonth();
      runYear = d.getFullYear();
      runStartIdx = colIdx;
    }
    dayRow.getCell(colIdx).value = d.getDate();
    dayRow.getCell(colIdx).alignment = { horizontal: "center" };
    dayRow.getCell(colIdx).font = { size: 9 };
  }
  // Close out the final month run.
  {
    const startCol = runStartIdx;
    const endCol = days.length + 1;
    if (endCol > startCol) {
      ganttSheet.mergeCells(1, startCol, 1, endCol);
    }
    const cell = monthRow.getCell(startCol);
    cell.value = `${MONTHS_SHORT[runMonth]} ${runYear}`;
    cell.alignment = { horizontal: "center" };
    cell.font = { bold: true, size: 10 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argb("F1F5F9") },
    };
  }

  // Pre-shade weekend / holiday columns on the day-row for visual scan.
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const dayCell = dayRow.getCell(i + 2);
    const dow = d.getDay();
    const iso = fmtIsoDate(d);
    if (holidayDates.has(iso)) {
      dayCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: argb(HOLIDAY_HEX.replace(/^#/, "")) },
      };
    } else if (dow === 0 || dow === 6) {
      dayCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: argb(WEEKEND_HEX.replace(/^#/, "")) },
      };
    }
    if (d.getTime() === today.getTime()) {
      dayCell.font = { bold: true, color: { argb: argb("EF4444") } };
    }
  }

  // Render task rows starting at row 3.
  let outRow = 3;
  for (const r of rows) {
    const cellRow = ganttSheet.getRow(outRow);
    const indent = r.kind === "subtask" ? "    " : r.kind === "task" ? "  " : "";
    const namePrefix = r.kind === "section" ? "▸ " : indent;
    cellRow.getCell(1).value = `${namePrefix}${r.name}`;
    if (r.kind === "section") {
      cellRow.getCell(1).font = { bold: true };
      cellRow.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: argb("F1F5F9") },
      };
    }

    // Background-tint the row's day cells (weekend/holiday) so the grid
    // remains readable even on rows without a task bar.
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const dow = d.getDay();
      const iso = fmtIsoDate(d);
      const cell = cellRow.getCell(i + 2);
      if (holidayDates.has(iso)) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: argb(HOLIDAY_HEX.replace(/^#/, ""), "33") },
        };
      } else if (dow === 0 || dow === 6) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: argb(WEEKEND_HEX.replace(/^#/, ""), "55") },
        };
      }
    }

    // Paint the task bar across start..due.
    if (r.start && r.end && (r.kind === "task" || r.kind === "subtask")) {
      const status = r.status ?? "TODO";
      const priority = r.priority ?? "MEDIUM";
      const fillHex = barFillHex(
        { status, priority, sectionColor: r.sectionColor },
        colorBy,
      ).replace(/^#/, "");
      const borderHex = PRIORITY_BORDER_HEX[priority].replace(/^#/, "");
      const startMs = startOfDay(r.start).getTime();
      const endMs = startOfDay(r.end).getTime();
      for (let i = 0; i < days.length; i++) {
        const dMs = days[i].getTime();
        if (dMs < startMs || dMs > endMs) continue;
        const cell = cellRow.getCell(i + 2);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: argb(fillHex) },
        };
        if (dMs === startMs) {
          cell.border = {
            ...(cell.border ?? {}),
            left: { style: "medium", color: { argb: argb(borderHex) } },
          };
        }
        if (r.isCriticalPath) {
          // Critical Path mark (plan §3): a violet frame on every painted
          // day cell of a marked task — the Excel analogue of the Gantt
          // bar's violet ring (there's no per-run outline across a series
          // of unmerged single-day cells, so top+bottom on each cell reads
          // as the same continuous frame). Merged in, not replacing, so the
          // start cell keeps its `left` border above.
          cell.border = {
            ...(cell.border ?? {}),
            top: { style: "medium", color: { argb: argb(CRITICAL_PATH_HEX.replace(/^#/, "")) } },
            bottom: {
              style: "medium",
              color: { argb: argb(CRITICAL_PATH_HEX.replace(/^#/, "")) },
            },
          };
        }
      }
    }

    // Today indicator: draw a thin red border on this row's "today" cell.
    for (let i = 0; i < days.length; i++) {
      if (days[i].getTime() === today.getTime()) {
        const cell = cellRow.getCell(i + 2);
        cell.border = {
          ...(cell.border ?? {}),
          right: { style: "thin", color: { argb: argb("EF4444") } },
        };
      }
    }
    outRow++;
  }
  ganttSheet.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];

  // ────────── Trigger download ──────────
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(projectName)}_gantt_${fmtIsoDate(new Date())}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
