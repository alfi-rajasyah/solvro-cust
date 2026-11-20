// The Utilization page's Workload tab (docs/archive/plans/workload-tab.md):
// open Solvro tasks per assignee for a week, with one summary strip and one
// row per person. Clicking a row opens that person's tasks under it, each
// linking to the task panel. Below md each row reflows into a card and the
// header row is hidden; each number carries its own short label.
import { useState } from "react";
import { Link } from "react-router-dom";
import { StatStrip } from "@/components/StatStrip";
import { TaskStatusChip } from "@/components/StatusChip";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { TableSkeleton } from "@/components/skeletons";
import { ApiError } from "@/lib/api";
import { dayFromIso } from "@/lib/dateField";
import { EMPTY_VALUE } from "@/lib/emptyValue";
import { fmtDue } from "@/lib/formatDate";
import { useWorkload, useWorkloadTasks, type WorkloadRow } from "@/lib/queries";
import { isOverdueDay, scopeNote, taskHref, workloadStats } from "./workloadPresentation";

const GRID = "grid-cols-5 md:grid-cols-[minmax(180px,1fr)_repeat(5,112px)]";

const COLUMNS: { key: keyof WorkloadRow; label: string; short: string }[] = [
  { key: "open", label: "Open", short: "Open" },
  { key: "dueThisWeek", label: "Due in week", short: "Due" },
  { key: "overdue", label: "Overdue", short: "Overdue" },
  { key: "activeInWeek", label: "Active in week", short: "Active" },
  { key: "storyPoints", label: "Story points", short: "Points" },
];

function Num({ value, bad = false }: { value: number; bad?: boolean }) {
  const tone = value === 0 ? "text-on-surface-variant" : bad ? "text-error" : "text-on-surface";
  return <span className={`font-mono tabular-nums ${tone}`}>{value}</span>;
}

function TaskList({ row, today }: { row: WorkloadRow; today: string }) {
  const { data, isLoading, isError } = useWorkloadTasks(row.userId ?? "unassigned");
  return (
    <div
      data-testid="workload-detail"
      className="border-t border-outline-variant bg-surface-container-low px-3 py-2 md:px-4"
    >
      {isLoading && <TableSkeleton rows={2} columns={3} widths={["w-3/4", "w-16", "w-16"]} />}
      {isError && (
        <p className="py-2 text-sm text-error">Could not load this person's tasks.</p>
      )}
      {data && data.tasks.length === 0 && data.hiddenCount === 0 && (
        <p className="py-2 text-sm text-on-surface-variant">No open tasks.</p>
      )}
      {data && data.tasks.length > 0 && (
        <ul className="divide-y divide-outline-variant">
          {data.tasks.map((t) => {
            const due = dayFromIso(t.dueDate);
            return (
              <li key={t.id}>
                <Link
                  to={taskHref(t.projectId, t.id)}
                  data-testid="workload-task"
                  className="tap-target flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm py-2 text-sm hover:bg-surface-container outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="min-w-0 flex-1 basis-48 truncate font-medium text-on-surface">{t.title}</span>
                  <span className="min-w-0 max-w-48 truncate text-meta text-on-surface-variant">{t.projectName}</span>
                  <span className="w-32 min-w-0">
                    <TaskStatusChip status={t.status} def={t.statusDef} />
                  </span>
                  <span
                    className={`w-20 text-right text-meta tabular-nums ${
                      isOverdueDay(due, today) ? "text-error" : "text-on-surface-variant"
                    }`}
                  >
                    {due ? fmtDue(due, today) : EMPTY_VALUE}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.hiddenCount > 0 && (
        <p data-testid="workload-hidden" className="py-2 text-meta text-on-surface-variant">
          {data.hiddenCount === 1
            ? "1 more open task in a project you can't open."
            : `${data.hiddenCount} more open tasks in projects you can't open.`}
        </p>
      )}
      {data?.truncated && (
        <p className="py-2 text-meta text-on-surface-variant">Showing the first {data.tasks.length} open tasks.</p>
      )}
    </div>
  );
}

function Row({
  row,
  today,
  expanded,
  onToggle,
}: {
  row: WorkloadRow;
  today: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-t border-outline-variant" data-testid="workload-row" data-row-key={row.key}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`grid w-full ${GRID} items-baseline gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-surface-container-low outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary`}
      >
        <span className="col-span-5 flex min-w-0 items-center gap-2 md:col-span-1">
          <span
            aria-hidden="true"
            className={`material-symbols-outlined text-lg text-on-surface-variant transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            chevron_right
          </span>
          <span className={`truncate ${row.userId === null ? "text-on-surface-variant" : "font-medium text-on-surface"}`}>
            {row.name}
          </span>
          {!row.active && <span className="text-meta text-on-surface-variant">Inactive</span>}
        </span>
        {COLUMNS.map((c) => (
          <span key={c.key} className="text-center md:text-right">
            <span
              aria-hidden="true"
              className="block font-display text-label-caps uppercase leading-tight text-on-surface-variant md:hidden"
            >
              {c.short}
            </span>
            <span className="sr-only">{c.label}</span>
            <Num value={row[c.key] as number} bad={c.key === "overdue"} />
          </span>
        ))}
      </button>
      {expanded && <TaskList row={row} today={today} />}
    </div>
  );
}

export function WorkloadTab({ week, enabled = true }: { week: string; enabled?: boolean }) {
  const { data, isLoading, isError, error } = useWorkload(week, { enabled });
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (isLoading || (!data && !isError)) {
    return <TableSkeleton rows={4} columns={6} widths={["w-3/4", "w-8", "w-8", "w-8", "w-8", "w-8"]} />;
  }
  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load workload{error instanceof ApiError ? `: ${error.message}` : "."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <StatStrip items={workloadStats(data.totals)} label="Workload summary" testId="workload-stats" />
      <p className="text-meta text-on-surface-variant" data-testid="workload-scope-note">
        {scopeNote(data.scope)}
      </p>
      <div className="overflow-x-auto rounded-sm border border-outline-variant bg-surface-container-lowest">
        <div className="md:min-w-[760px]">
          <div className={`grid ${GRID} max-md:hidden`}>
            <div className="bg-surface-container px-3 py-2 pl-10 font-display text-label-caps uppercase text-on-surface-variant">
              Person
            </div>
            {COLUMNS.map((c) => (
              <div
                key={c.key}
                className="bg-surface-container px-3 py-2 text-right font-display text-label-caps uppercase text-on-surface-variant"
              >
                {c.label}
              </div>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <div
              data-testid="workload-no-rows"
              className="border-t border-outline-variant px-6 py-10 text-center text-sm text-on-surface-variant"
            >
              No open tasks to show.
            </div>
          ) : (
            data.rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                today={data.today}
                expanded={openKey === row.key}
                onToggle={() => setOpenKey(openKey === row.key ? null : row.key)}
              />
            ))
          )}
        </div>
      </div>
      <p className="text-xs text-on-surface-variant">
        Open and story points count every open task. Overdue is measured against today. Due and Active cover the selected week.
      </p>
    </div>
  );
}
