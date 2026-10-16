import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useProjectContext } from "../ProjectDetail";
import { hasPermission, useAuth } from "@/lib/auth";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { scoreClass, scoreLevel } from "@/components/RiskFormModal";
import { OutlineMentions } from "@/components/OutlineMentions";
import { ProjectActivity } from "@/components/ProjectActivity";
import { Chip } from "@/components/StatusChip";
import { dateToDay, dayFromIso } from "@/lib/dateField";
import { fmtDay } from "@/lib/formatDate";
import { TASK_STATUS_LABEL } from "@/lib/labels";
import { type Task, useProjectNotes, useProjectRisks, useProjectTasks } from "@/lib/queries";

export function ProjectOverview() {
  const { project, openContext } = useProjectContext();
  const { user } = useAuth();
  // Same gate as the Context panel's button (POST /projects/:id/baseline
  // requires project:write) — a read-only user must not be sent to a
  // panel that has no button for them.
  const canLockBaseline = hasPermission(user, "project:write");
  const { data: tasks, isLoading, isError, error } = useProjectTasks(project.id);

  const stats = useMemo(() => computeStats(tasks ?? []), [tasks]);
  const sCurve = useMemo(() => buildSCurve(tasks ?? []), [tasks]);
  const taskIds = useMemo(() => new Set((tasks ?? []).map((t) => t.id)), [tasks]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-48 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
          <div className="h-48 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load tasks: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {project.description && (
        <p className="max-w-3xl wrap-break-word text-sm text-on-surface-variant">
          {project.description}
        </p>
      )}

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon="checklist"
          label="Total tasks"
          value={String(stats.total)}
          hint={`${stats.topLevel} top-level · ${stats.subtasks} subtasks`}
        />
        <Kpi
          icon="task_alt"
          label="Completion"
          value={`${stats.pct}%`}
          hint={`${stats.done} of ${stats.total} done`}
          accent={stats.pct === 100 ? "emerald" : undefined}
          progress={stats.pct}
        />
        <Kpi
          icon="warning"
          label="Overdue"
          value={String(stats.overdue)}
          hint={stats.overdue > 0 ? "open tasks past due date" : "nothing overdue"}
          accent={stats.overdue > 0 ? "error" : "emerald"}
        />
        <Kpi
          icon={project.baselineLockedAt ? "lock" : "lock_open"}
          label="Baseline"
          value={project.baselineLockedAt ? "Locked" : "Not set"}
          hint={
            project.baselineLockedAt
              ? `by ${project.baselineLockedBy?.username ?? "—"} · ${fmtDay(dateToDay(new Date(project.baselineLockedAt)))}`
              : "Lock to capture planned dates"
          }
          accent={project.baselineLockedAt ? "primary" : undefined}
        />
      </div>

      {/* S-Curve segment */}
      <section className="rounded-sm border border-outline-variant bg-surface-container-lowest p-5">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-on-surface">
              Progress S-Curve
            </h3>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              Cumulative tasks scheduled to complete over time. Compares the locked
              baseline against the current (re-planned) schedule.
            </p>
          </div>
          {!project.baselineLockedAt && canLockBaseline && (
            <button
              type="button"
              onClick={openContext}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface hover:border-primary hover:text-primary"
            >
              <span className="material-symbols-outlined text-base">lock</span>
              Lock baseline
            </button>
          )}
        </header>

        {sCurve.points.length === 0 ? (
          <EmptyChart
            icon="show_chart"
            title="No scheduled tasks yet"
            body="Add start/due dates to tasks to populate the curve."
          />
        ) : !project.baselineLockedAt ? (
          <SCurveChart data={sCurve.points} todayIndex={sCurve.todayIndex} hasBaseline={false} />
        ) : (
          <SCurveChart data={sCurve.points} todayIndex={sCurve.todayIndex} hasBaseline={true} />
        )}

        {project.baselineLockedAt && sCurve.points.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-4 border-t border-outline-variant pt-3 text-xs text-on-surface-variant">
            <Legend2 swatch="bg-on-surface-variant/40" label="Baseline (planned)" />
            <Legend2 swatch="bg-primary" label="Current (re-planned)" />
            <Legend2 swatch="bg-emerald-500" label={`Completed today: ${stats.done}/${stats.total}`} />
            <span className="ml-auto font-mono">
              Slip:{" "}
              <span className={sCurve.slipDays > 0 ? "text-error" : "text-emerald-600"}>
                {sCurve.slipDays > 0 ? `+${sCurve.slipDays}` : sCurve.slipDays} days
              </span>
            </span>
          </div>
        )}
      </section>

      {/* Detail panels — the TAM's morning glance */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <NeedsAttention tasks={tasks ?? []} projectId={project.id} />
        <div className="grid grid-cols-1 gap-4">
          <StatusBreakdown tasks={tasks ?? []} />
          <TopRisks projectId={project.id} />
          <ProjectNotesPanel projectId={project.id} />
          <OutlineMentions scope={{ kind: "project", id: project.id }} variant="card" />
        </div>
      </div>

      <ProjectActivity projectId={project.id} tam={project.tam} taskIds={taskIds} />
    </div>
  );
}

const PANEL_CLASS =
  "rounded-sm border border-outline-variant bg-surface-container-lowest p-4";
const PANEL_HEADING =
  "text-label-caps uppercase text-on-surface-variant";

function NeedsAttention({ tasks, projectId }: { tasks: Task[]; projectId: number }) {
  const today = dateToDay(startOfToday())!;
  const rows = tasks
    .filter((t) => t.status !== "DONE" && t.dueDate)
    .map((t) => ({ task: t, delta: dayDelta(dayFromIso(t.dueDate!)!, today) }))
    .filter((r) => r.delta <= 7)
    .sort((a, b) => a.delta - b.delta);
  const shown = rows.slice(0, 6);

  return (
    <section className={PANEL_CLASS}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className={PANEL_HEADING}>Needs attention</h3>
        <span className="text-xs text-on-surface-variant">overdue + next 7 days</span>
      </header>
      {shown.length === 0 ? (
        <PanelEmpty icon="check_circle" text="Nothing overdue or due in the next 7 days." />
      ) : (
        <ul className="-mx-2">
          {shown.map(({ task, delta }) => (
            <li key={task.id}>
              <Link
                to={`?task=${task.id}`}
                className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-surface-container"
              >
                <span className="min-w-0 truncate text-sm text-on-surface">
                  {task.title}
                </span>
                <span className="shrink-0">
                  <Chip tone={delta < 0 ? "rose" : "amber"}>
                    {delta < 0
                      ? `${-delta}d overdue`
                      : delta === 0
                        ? "due today"
                        : `due in ${delta}d`}
                  </Chip>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && (
        <Link
          to={`/projects/${projectId}/list`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          {rows.length - shown.length} more in List
          <span className="material-symbols-outlined text-[15px]">chevron_right</span>
        </Link>
      )}
    </section>
  );
}

function StatusBreakdown({ tasks }: { tasks: Task[] }) {
  const done = tasks.filter((t) => t.status === "DONE").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const todo = tasks.length - done - inProgress;
  const pct = (n: number) => `${(n / tasks.length) * 100}%`;

  return (
    <section className={PANEL_CLASS}>
      <h3 className={`${PANEL_HEADING} mb-3`}>Status breakdown</h3>
      {tasks.length === 0 ? (
        <PanelEmpty icon="list_alt" text="No tasks yet." />
      ) : (
        <>
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-container-high">
            {done > 0 && <div className="bg-primary" style={{ width: pct(done) }} />}
            {inProgress > 0 && (
              <div className="bg-primary/45" style={{ width: pct(inProgress) }} />
            )}
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            <BreakdownRow swatch="bg-primary" label={TASK_STATUS_LABEL.DONE} count={done} />
            <BreakdownRow swatch="bg-primary/45" label={TASK_STATUS_LABEL.IN_PROGRESS} count={inProgress} />
            <BreakdownRow swatch="bg-surface-container-high" label={TASK_STATUS_LABEL.TODO} count={todo} />
          </dl>
        </>
      )}
    </section>
  );
}

function BreakdownRow({
  swatch,
  label,
  count,
}: {
  swatch: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="inline-flex items-center gap-1.5 text-on-surface-variant">
        <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} />
        {label}
      </dt>
      <dd className="font-medium tabular-nums text-on-surface">{count}</dd>
    </div>
  );
}

function TopRisks({ projectId }: { projectId: number }) {
  const { data: risks, isLoading, isError } = useProjectRisks(projectId);
  const top = (risks ?? [])
    .filter((r) => r.status === "OPEN")
    .sort((a, b) => b.probability * b.impact - a.probability * a.impact)
    .slice(0, 3);

  return (
    <section className={PANEL_CLASS}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className={PANEL_HEADING}>Top open risks</h3>
        <Link
          to={`/projects/${projectId}/risks`}
          className="text-xs font-semibold text-primary hover:underline"
        >
          View all
        </Link>
      </header>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-sm bg-surface-container-low" />
      ) : isError ? (
        <p className="text-xs text-on-surface-variant">Could not load risks.</p>
      ) : top.length === 0 ? (
        <PanelEmpty icon="shield" text="No open risks." />
      ) : (
        <ul className="space-y-2">
          {top.map((risk) => {
            const score = risk.probability * risk.impact;
            return (
              <li key={risk.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-on-surface">
                  {risk.description}
                </span>
                <span
                  className={[
                    "flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-bold tabular-nums",
                    scoreClass(score),
                  ].join(" ")}
                  title={`${risk.probability} × ${risk.impact} = ${score}`}
                >
                  {score}
                  <span className="font-display text-label-caps uppercase">
                    {scoreLevel(score)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ProjectNotesPanel({ projectId }: { projectId: number }) {
  // Last 14 calendar days, inclusive of today — computed in UTC from the day
  // string (`daysBefore`) rather than a local `Date#setDate`, which can walk
  // a day off across a DST transition (same rationale as isoWeek.ts's
  // UTC-only arithmetic).
  const windowTo = dateToDay(new Date())!;
  const windowFrom = daysBefore(windowTo, 13);
  const { data: notes, isLoading, isError } = useProjectNotes(projectId, {
    from: windowFrom,
    to: windowTo,
  });

  return (
    <section className={PANEL_CLASS}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className={PANEL_HEADING}>Notes</h3>
        <Link
          to="/daily-review"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Log a note
        </Link>
      </header>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-sm bg-surface-container-low" />
      ) : isError ? (
        <p className="text-xs text-on-surface-variant">Could not load notes.</p>
      ) : !notes || notes.length === 0 ? (
        <PanelEmpty icon="edit_note" text="No notes in the last 14 days." />
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="text-sm">
              <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-on-surface-variant">
                  {fmtDay(note.noteDate)}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {note.author.username}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-on-surface">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// UTC day-string arithmetic — `day` minus `n` days, computed via UTC-getters
// on a UTC-midnight parse of the day string (never local `setDate`, whose
// local-timezone rollover can land on the wrong calendar day at a DST
// transition). Mirrors isoWeek.ts's UTC-only day math.
function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function PanelEmpty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-dashed border-outline-variant px-3 py-4 text-xs text-on-surface-variant">
      <span className="material-symbols-outlined text-base">{icon}</span>
      {text}
    </div>
  );
}

// Delta in calendar days between two "yyyy-MM-dd" days (dateField.ts contract);
// local-midnight parse + rounding absorbs DST-shifted day lengths.
function dayDelta(day: string, today: string): number {
  const ms =
    new Date(day + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime();
  return Math.round(ms / 86400000);
}

function Kpi({
  icon,
  label,
  value,
  hint,
  accent,
  progress,
}: {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  accent?: "primary" | "emerald" | "error";
  progress?: number;
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-600"
      : accent === "error"
        ? "text-error"
        : accent === "primary"
          ? "text-primary"
          : "text-on-surface";
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex items-center justify-between">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <span className={`material-symbols-outlined text-base ${accent === "primary" ? "text-primary" : accent === "emerald" ? "text-emerald-600" : accent === "error" ? "text-error" : "text-on-surface-variant"}`}>{icon}</span>
      </div>
      <div className={`mt-2 font-body text-3xl font-bold tabular-nums ${accentClass}`}>{value}</div>
      {progress !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-container-high">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {hint && <div className="mt-1 text-xs text-on-surface-variant">{hint}</div>}
    </div>
  );
}

function Legend2({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} />
      {label}
    </span>
  );
}

function EmptyChart({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-outline-variant text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant">{icon}</span>
      <p className="text-sm font-semibold text-on-surface">{title}</p>
      <p className="text-xs text-on-surface-variant">{body}</p>
    </div>
  );
}

interface SCurvePoint {
  date: string;
  label: string;
  baseline: number | null;
  current: number;
}

function SCurveChart({
  data,
  todayIndex,
  hasBaseline,
}: {
  data: SCurvePoint[];
  todayIndex: number | null;
  hasBaseline: boolean;
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="scurve-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.16} />
              <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgb(var(--outline-variant))" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "rgb(var(--on-surface-variant))" }}
            tickLine={false}
            axisLine={{ stroke: "rgb(var(--outline-variant))" }}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "rgb(var(--on-surface-variant))" }}
            tickLine={false}
            axisLine={{ stroke: "rgb(var(--outline-variant))" }}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid rgb(var(--outline-variant))",
              fontSize: 12,
            }}
            labelStyle={{ fontSize: 11, color: "rgb(var(--on-surface-variant))" }}
          />
          <Legend wrapperStyle={{ display: "none" }} />
          {todayIndex !== null && (
            <ReferenceLine
              x={data[todayIndex]?.label}
              stroke="rgb(var(--on-surface-variant))"
              strokeDasharray="4 4"
              label={{
                value: "Today",
                position: "insideTopRight",
                fill: "rgb(var(--on-surface-variant))",
                fontSize: 11,
              }}
            />
          )}
          {hasBaseline && (
            <Line
              type="monotone"
              dataKey="baseline"
              name="Baseline"
              stroke="rgb(var(--on-surface-variant))"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="current"
            stroke="none"
            fill="url(#scurve-fill)"
            activeDot={false}
            tooltipType="none"
            legendType="none"
          />
          <Line
            type="monotone"
            dataKey="current"
            name="Current"
            stroke="rgb(var(--primary))"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface Stats {
  total: number;
  topLevel: number;
  subtasks: number;
  done: number;
  pct: number;
  overdue: number;
}

function computeStats(tasks: Task[]): Stats {
  const total = tasks.length;
  const topLevel = tasks.filter((t) => t.parentTaskId === null).length;
  const subtasks = total - topLevel;
  const done = tasks.filter((t) => t.status === "DONE").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const today = startOfToday();
  // Compare calendar days, not instants —
  // lexicographic "yyyy-MM-dd" comparison is calendar-correct (dateField.ts).
  const overdue = tasks.filter(
    (t) => t.status !== "DONE" && t.dueDate && dayFromIso(t.dueDate)! < dateToDay(today)!,
  ).length;
  return { total, topLevel, subtasks, done, pct, overdue };
}

interface SCurve {
  points: SCurvePoint[];
  todayIndex: number | null;
  slipDays: number;
}

function buildSCurve(tasks: Task[]): SCurve {
  const datedTasks = tasks.filter((t) => t.dueDate || t.baselineDueDate);
  if (datedTasks.length === 0) {
    return { points: [], todayIndex: null, slipDays: 0 };
  }

  const dateSet = new Set<string>();
  for (const t of datedTasks) {
    if (t.dueDate) dateSet.add(t.dueDate.slice(0, 10));
    if (t.baselineDueDate) dateSet.add(t.baselineDueDate.slice(0, 10));
  }
  const today = dateToDay(startOfToday())!;
  dateSet.add(today);

  const sortedDates = Array.from(dateSet).sort();

  // Pre-extract due-date-only strings for cumulative counting.
  const baselineDates = datedTasks
    .map((t) => t.baselineDueDate?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort();
  const currentDates = datedTasks
    .map((t) => t.dueDate?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort();
  const hasBaseline = baselineDates.length > 0;

  const points: SCurvePoint[] = sortedDates.map((date) => ({
    date,
    label: fmtDay(date),
    baseline: hasBaseline ? cumulativeCount(baselineDates, date) : null,
    current: cumulativeCount(currentDates, date),
  }));

  const todayIndex = sortedDates.indexOf(today);

  // "Slip" = days between baseline final completion and current final completion.
  let slipDays = 0;
  if (hasBaseline && baselineDates.length > 0 && currentDates.length > 0) {
    const baselineEnd = new Date(baselineDates[baselineDates.length - 1]);
    const currentEnd = new Date(currentDates[currentDates.length - 1]);
    slipDays = Math.round(
      (currentEnd.getTime() - baselineEnd.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  return { points, todayIndex: todayIndex >= 0 ? todayIndex : null, slipDays };
}

// Counts entries in `sortedDates` that are `<= cutoff`. Linear scan is fine
// here since project task counts are small (typically < 1000).
function cumulativeCount(sortedDates: string[], cutoff: string): number {
  let n = 0;
  for (const d of sortedDates) {
    if (d <= cutoff) n++;
    else break;
  }
  return n;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
