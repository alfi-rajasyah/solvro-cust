import { PROJECT_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/labels";
import { CATEGORY_DEFAULT_TONE } from "@/lib/taskStatuses";
import type { ProjectStatus, StatusTone, TaskStatus } from "@/lib/queries";

export type Tone = "emerald" | "amber" | "rose" | "violet" | "blue" | "gray";

const TONE_CLASS: Record<Tone, string> = {
  emerald: "bg-chip-emerald-bg text-chip-emerald-text",
  amber: "bg-chip-amber-bg text-chip-amber-text",
  rose: "bg-chip-rose-bg text-chip-rose-text",
  violet: "bg-chip-violet-bg text-chip-violet-text",
  blue: "bg-primary/10 text-primary-tint-text dark:bg-primary/20",
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

// Tone keys of a workspace status (docs/archive/plans/custom-task-statuses.md §1)
// -> the chip's existing tone classes. "primary" is the In-progress tint.
const STATUS_TONE: Record<StatusTone, Tone> = {
  gray: "gray",
  primary: "blue",
  emerald: "emerald",
  amber: "amber",
  violet: "violet",
};

const TASK_TONE: Record<TaskStatus, Tone> = {
  TODO: STATUS_TONE[CATEGORY_DEFAULT_TONE.TODO],
  IN_PROGRESS: STATUS_TONE[CATEGORY_DEFAULT_TONE.IN_PROGRESS],
  DONE: STATUS_TONE[CATEGORY_DEFAULT_TONE.DONE],
};

// Tone classes for hand-rolled status controls (button-wrapped chips) that
// need the same colours as TaskStatusChip without rendering it.
export const TASK_STATUS_TONE_CLASS: Record<TaskStatus, string> = {
  TODO: TONE_CLASS[TASK_TONE.TODO],
  IN_PROGRESS: TONE_CLASS[TASK_TONE.IN_PROGRESS],
  DONE: TONE_CLASS[TASK_TONE.DONE],
};

/** The slice of a workspace status that decides how a chip reads. */
export interface StatusDisplay {
  name: string;
  color: StatusTone;
}

/** Chip tone classes for a workspace status; a bare category keeps today's tone. */
export function statusToneClass(def: Pick<StatusDisplay, "color"> | null | undefined, category: TaskStatus): string {
  return def ? TONE_CLASS[STATUS_TONE[def.color]] : TASK_STATUS_TONE_CLASS[category];
}

/** Matching small dot (Gantt tree, pickers); same tones as the chip. */
export const STATUS_TONE_DOT_CLASS: Record<StatusTone, string> = {
  // on-surface-variant, not a container tone: those vanish on the dark popover/column.
  gray: "bg-on-surface-variant",
  primary: "bg-primary",
  emerald: "bg-chip-emerald-text",
  amber: "bg-chip-amber-text",
  violet: "bg-chip-violet-text",
};

export const CHIP_BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-display text-meta font-semibold leading-[18px]";

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span className={`${CHIP_BASE} ${TONE_CLASS[PROJECT_TONE[status]]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * A task's status chip. Pass `def` (the task's `statusDef`) to show the
 * workspace status's own name and tone; without it (epics, guest/share links,
 * anything that only knows the category) it renders the bare category as before.
 */
export function TaskStatusChip({ status, def }: { status: TaskStatus; def?: StatusDisplay | null }) {
  const name = def ? def.name : TASK_STATUS_LABEL[status];
  // Names go up to 40 characters: shrink into a fixed-width cell and ellipsise.
  return (
    <span className={`${CHIP_BASE} max-w-full min-w-0 ${statusToneClass(def, status)}`} title={name}>
      <span className="truncate">{name}</span>
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
