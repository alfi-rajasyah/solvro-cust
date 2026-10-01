import { PROJECT_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import type { ProjectStatus, TaskStatus } from "@/lib/queries";

type Tone = "emerald" | "amber" | "rose" | "violet" | "blue" | "gray";

const TONE_CLASS: Record<Tone, string> = {
  emerald: "bg-chip-emerald-bg text-chip-emerald-text",
  amber: "bg-chip-amber-bg text-chip-amber-text",
  rose: "bg-chip-rose-bg text-chip-rose-text",
  violet: "bg-chip-violet-bg text-chip-violet-text",
  blue: "bg-primary/10 text-primary dark:bg-primary/20",
  gray: "bg-surface-container-high text-on-surface-variant",
};

const PROJECT_TONE: Record<ProjectStatus, Tone> = {
  PLANNING: "blue",
  ACTIVE: "emerald",
  ON_HOLD: "amber",
  COMPLETED: "blue",
  CANCELLED: "rose",
};

// Humanized status text for non-chip surfaces (e.g. CommandPalette's hint
// slot) that want the same mapping without rendering a full colored chip.
export function projectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_LABEL[status];
}

const TASK_TONE: Record<TaskStatus, Tone> = {
  TODO: "gray",
  IN_PROGRESS: "blue",
  DONE: "emerald",
};

// Tone classes for hand-rolled status controls (button-wrapped chips) that
// need the same colours as TaskStatusChip without rendering it.
export const TASK_STATUS_TONE_CLASS: Record<TaskStatus, string> = {
  TODO: TONE_CLASS[TASK_TONE.TODO],
  IN_PROGRESS: TONE_CLASS[TASK_TONE.IN_PROGRESS],
  DONE: TONE_CLASS[TASK_TONE.DONE],
};

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-meta font-semibold leading-[18px]";

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span className={`${CHIP_BASE} ${TONE_CLASS[PROJECT_TONE[status]]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </span>
  );
}

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return (
    <span className={`${CHIP_BASE} ${TONE_CLASS[TASK_TONE[status]]}`}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

export function Chip({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return <span className={`${CHIP_BASE} ${TONE_CLASS[tone]}`}>{children}</span>;
}
