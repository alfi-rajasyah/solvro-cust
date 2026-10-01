// Project card (spec §6.3 pins 4/5/8): header (collapse toggle, name,
// status, schedule chip, reviewed badge/mark-reviewed button), metrics row
// (phase, progress), attention row (overdue tasks / open risks with inline
// status selects), and the Mon..Sun note editor. `unassigned` adds the
// "no customer" banner (pin 8) — the weekly-update block itself is never
// rendered here; it's per-customer, owned by CustomerGroup.
//
// Two independent folds, both default-expanded and manual-only (nothing is
// persisted; state resets with the page): the header chevron folds the
// whole body (metrics + attention + notes) to the header row, which then
// carries the overdue/open-risk counts; the attention row's own
// "Hide lists"/"Show lists" folds just the two lists to a one-line count
// summary. A day-strip focus request aimed at this card (isFirstCard) must
// reach the note editor even when the body is folded — it force-expands
// the body with the same dismissed-token bookkeeping CustomerGroup uses.
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmModal } from "@/components/ConfirmModal";
import { scoreClass, scoreLevel } from "@/components/RiskFormModal";
import { ProjectStatusChip } from "@/components/StatusChip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dueDateLabel } from "@/lib/dailyReviewStats";
import { dayFromIso } from "@/lib/dateField";
import { fmtTime } from "@/lib/formatDate";
import { riskStatusOptions, taskStatusOptions } from "@/lib/labels";
import {
  type DailyReviewProject,
  type RiskStatus,
  type TaskStatus,
  useAddProjectNote,
  useDeleteProjectNote,
  useMarkProjectReviewed,
  useUnmarkProjectReviewed,
  useUpdateProjectNote,
  useUpdateRisk,
  useUpdateTask,
} from "@/lib/queries";
import { WeekNotesEditor } from "./WeekNotesEditor";

type ScheduleTone = "rose" | "emerald" | "neutral";

const SCHEDULE_CLASS: Record<ScheduleTone, string> = {
  rose: "bg-chip-rose-bg text-chip-rose-text",
  emerald: "bg-chip-emerald-bg text-chip-emerald-text",
  neutral: "bg-surface-container-high text-on-surface-variant",
};

function scheduleChip(project: DailyReviewProject): { label: string; tone: ScheduleTone } {
  if (project.slipDays === null) return { label: "No baseline", tone: "neutral" };
  if (project.slipDays > 0) return { label: `${project.slipDays}d behind`, tone: "rose" };
  if (project.slipDays < 0) return { label: `${-project.slipDays}d ahead`, tone: "emerald" };
  return { label: "On schedule", tone: "emerald" };
}

export interface ProjectCardProps {
  project: DailyReviewProject;
  today: string;
  days: string[];
  currentUserId: number;
  canDeleteAny: boolean;
  isFirstCard: boolean;
  focusRequest: { day: string; token: number } | null;
  /** Renders the "no customer" banner (spec §6.3 pin 8) — set only by UnassignedGroup. */
  unassigned?: boolean;
}

export function ProjectCard({
  project,
  today,
  days,
  currentUserId,
  canDeleteAny,
  isFirstCard,
  focusRequest,
  unassigned = false,
}: ProjectCardProps) {
  const addNote = useAddProjectNote(project.id);
  const updateNote = useUpdateProjectNote(project.id);
  const deleteNote = useDeleteProjectNote(project.id);
  const markReviewed = useMarkProjectReviewed(project.id);
  const unmarkReviewed = useUnmarkProjectReviewed(project.id);
  const updateTask = useUpdateTask(project.id);
  const updateRisk = useUpdateRisk(project.id);

  const [confirmUnmark, setConfirmUnmark] = useState(false);

  const [manualBodyExpanded, setManualBodyExpanded] = useState(true);
  const [dismissedFocusToken, setDismissedFocusToken] = useState<number | null>(null);
  const forceExpand = isFirstCard && focusRequest !== null && focusRequest.token !== dismissedFocusToken;
  const bodyExpanded = forceExpand || manualBodyExpanded;
  const [attentionExpanded, setAttentionExpanded] = useState(true);
  const bodyId = `project-body-${project.id}`;
  const attentionId = `project-attention-${project.id}`;

  function toggleBody() {
    const next = !bodyExpanded;
    setManualBodyExpanded(next);
    // Folding while a day-strip force-expand is in effect must dismiss that
    // token, or `forceExpand` would immediately re-open the body.
    if (!next && focusRequest) setDismissedFocusToken(focusRequest.token);
  }

  const pct =
    project.progress.total === 0 ? 0 : Math.round((project.progress.done / project.progress.total) * 100);
  const schedule = scheduleChip(project);
  // `reviewDate` arrives as an ISO instant ("yyyy-MM-ddT00:00:00.000Z"), not
  // a bare day string — compare via `dayFromIso`, never `===` against `today`.
  const reviewToday = project.reviews.find((r) => dayFromIso(r.reviewDate) === today);
  const hasAttention = project.overdueTasks.length > 0 || project.openRisks.length > 0;

  return (
    <article className="rounded-sm border border-outline-variant bg-surface-container-lowest">
      {unassigned && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-outline-variant bg-chip-amber-bg px-4 py-2 text-[12px] font-medium text-chip-amber-text">
          <span className="material-symbols-outlined text-base">warning</span>
          <span>
            Weekly updates are per customer. Assign a customer to{" "}
            <Link to={`/projects/${project.id}/overview`} className="underline hover:no-underline">
              {project.name}
            </Link>{" "}
            to include it. Daily notes still work.
          </span>
        </div>
      )}

      <header
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${
          bodyExpanded ? "border-b border-outline-variant" : ""
        }`}
      >
        <button
          type="button"
          onClick={toggleBody}
          aria-expanded={bodyExpanded}
          aria-controls={bodyId}
          aria-label={bodyExpanded ? "Collapse project" : "Expand project"}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">
            {bodyExpanded ? "expand_less" : "expand_more"}
          </span>
        </button>
        <span className="rounded-sm bg-surface-container-high px-1.5 py-0.5 text-label-caps leading-4 uppercase text-on-surface-variant">
          Project
        </span>
        <Link
          to={`/projects/${project.id}/overview`}
          className="font-display text-sm font-semibold text-on-surface hover:text-primary"
        >
          {project.name}
        </Link>
        <ProjectStatusChip status={project.status} />
        <span
          className={`rounded-full px-2 py-0.5 text-meta font-semibold ${SCHEDULE_CLASS[schedule.tone]}`}
          title="Schedule variance vs. locked baseline"
        >
          {schedule.label}
        </span>
        {!bodyExpanded && hasAttention && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <AttentionCount label="Overdue" count={project.overdueTasks.length} tone="bad" />
            <AttentionCount label="Open risks" count={project.openRisks.length} tone="warn" />
          </span>
        )}
        <div className="ml-auto">
          {reviewToday ? (
            <button
              type="button"
              onClick={() => setConfirmUnmark(true)}
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <span className="flex items-center gap-1 rounded-full bg-chip-emerald-bg px-2 py-0.5 text-meta font-bold text-chip-emerald-text">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Reviewed {fmtTime(reviewToday.createdAt)}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => markReviewed.mutate({ reviewDate: today })}
              disabled={markReviewed.isPending}
              className="rounded-sm border border-outline-variant px-2.5 py-1 text-meta font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Mark reviewed
            </button>
          )}
        </div>
      </header>

      <ConfirmModal
        open={confirmUnmark}
        onClose={() => setConfirmUnmark(false)}
        onConfirm={() => {
          unmarkReviewed.mutate({ reviewDate: today });
          setConfirmUnmark(false);
        }}
        title="Remove review mark"
        body="Remove today's review mark?"
        confirmLabel="Remove"
        confirmTone="warning"
      />

      {bodyExpanded && (
        <div id={bodyId}>
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-outline-variant px-4 py-2.5">
            <Metric label="Phase" value={project.phase} />
            <Metric label="Progress" value={`${pct}%`} sub={`${project.progress.done}/${project.progress.total}`} />
          </div>

          <div className="relative border-b border-outline-variant px-4 py-3">
            {hasAttention ? (
              <>
                <button
                  type="button"
                  onClick={() => setAttentionExpanded((v) => !v)}
                  aria-expanded={attentionExpanded}
                  aria-controls={attentionId}
                  className="absolute right-4 top-3 text-meta font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  {attentionExpanded ? "Hide lists" : "Show lists"}
                </button>
                <div id={attentionId}>
                  {attentionExpanded ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <AttentionColumn label="Overdue" count={project.overdueTasks.length} tone="bad">
                        {project.overdueTasks.map((t) => {
                          // Inline status changes here round-trip (no optimistic
                          // write on this page) — show a pending state on the row
                          // rather than letting the select silently snap back.
                          const pending = updateTask.isPending && updateTask.variables?.id === t.id;
                          return (
                            <li key={t.id} className={`flex items-center gap-2 ${pending ? "opacity-60" : ""}`}>
                              <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{t.title}</span>
                              {t.dueDate && (
                                <span className="shrink-0 text-meta text-chip-rose-text">
                                  due {dueDateLabel(t.dueDate)}
                                </span>
                              )}
                              <Select
                                items={taskStatusOptions}
                                value={t.status}
                                onValueChange={(v) => updateTask.mutate({ id: t.id, patch: { status: v as TaskStatus } })}
                                disabled={pending}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="w-auto shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                  aria-label="Task status"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="end">
                                  {taskStatusOptions.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </li>
                          );
                        })}
                      </AttentionColumn>
                      <AttentionColumn label="Open risks" count={project.openRisks.length} tone="warn">
                        {project.openRisks.map((r) => {
                          const score = r.probability * r.impact;
                          const pending = updateRisk.isPending && updateRisk.variables?.id === r.id;
                          return (
                            <li key={r.id} className={`flex items-center gap-2 ${pending ? "opacity-60" : ""}`}>
                              <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{r.description}</span>
                              <span
                                className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-meta font-bold ${scoreClass(score)}`}
                                title={`${r.probability} × ${r.impact} = ${score}`}
                              >
                                {scoreLevel(score)}
                              </span>
                              <Select
                                items={riskStatusOptions}
                                value={r.status}
                                onValueChange={(v) => updateRisk.mutate({ id: r.id, patch: { status: v as RiskStatus } })}
                                disabled={pending}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="w-auto shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                  aria-label="Risk status"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="end">
                                  {riskStatusOptions.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </li>
                          );
                        })}
                      </AttentionColumn>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pr-16">
                      <AttentionCount label="Overdue" count={project.overdueTasks.length} tone="bad" />
                      <AttentionCount label="Open risks" count={project.openRisks.length} tone="warn" />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-on-surface-variant">Nothing overdue · no open risks</p>
            )}
          </div>

          <div className="px-4 py-3">
            <WeekNotesEditor
              // Keyed by the displayed week's Monday so switching weeks
              // remounts the editor fresh, instead of carrying its
              // collapsed/expanded (and in-progress edit) state across weeks.
              key={days[0]}
              days={days}
              today={today}
              notes={project.notes}
              currentUserId={currentUserId}
              canDeleteAny={canDeleteAny}
              placeholder='What happened on this project today? Nothing? Use "Mark reviewed".'
              ariaLabel={`Note for ${project.name}`}
              rowsId={`week-rows-project-${project.id}`}
              onAdd={(day, body) => addNote.mutate({ body, noteDate: day })}
              onUpdate={(noteId, body) => updateNote.mutate({ noteId, body })}
              onDelete={(noteId) => deleteNote.mutate({ noteId })}
              addPending={addNote.isPending}
              updatePending={updateNote.isPending}
              deletePending={deleteNote.isPending}
              focusDay={isFirstCard ? focusRequest?.day : undefined}
              focusToken={isFirstCard ? focusRequest?.token : undefined}
            />
          </div>
        </div>
      )}
    </article>
  );
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-label-caps uppercase text-on-surface-variant">{label}</div>
      <div className="truncate text-sm font-semibold text-on-surface">
        {value}
        {sub && <span className="ml-1 text-meta font-normal tabular-nums text-on-surface-variant">{sub}</span>}
      </div>
    </div>
  );
}

function AttentionColumn({
  label,
  count,
  tone,
  children,
}: {
  label: string;
  count: number;
  tone: "bad" | "warn";
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1">
        <AttentionCount label={label} count={count} tone={tone} />
      </div>
      {count > 0 ? (
        <ul className="space-y-1.5">{children}</ul>
      ) : (
        <p className="text-xs italic text-on-surface-variant">None</p>
      )}
    </div>
  );
}

// One "OVERDUE 10"-style label + toned mono count. Used as each attention
// column's heading, and as the one-line summary when the lists or the whole
// card body are folded.
function AttentionCount({ label, count, tone }: { label: string; count: number; tone: "bad" | "warn" }) {
  const toneClass = tone === "bad" ? "text-chip-rose-text" : "text-chip-amber-text";
  return (
    <span className="flex items-center gap-1.5 text-label-caps uppercase text-on-surface-variant">
      {label} <span className={`tabular-nums ${toneClass}`}>{count}</span>
    </span>
  );
}
