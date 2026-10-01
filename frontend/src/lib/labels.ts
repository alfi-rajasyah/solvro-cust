// Single source of display words for the domain enums. Every surface (chips,
// selects, Kanban headers, exports) imports from here so one status never
// reads three different ways.
import type {
  Priority,
  PublicPhaseStatus,
  ProjectStatus,
  RiskCategory,
  RiskStatus,
  TaskStatus,
  WeeklyHealth,
  WeeklyStatus,
} from "@/lib/queries";
import type { ShareLinkStatus } from "@/lib/shareLinks";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  OPEN: "Open",
  MITIGATED: "Mitigated",
  CLOSED: "Closed",
};

export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  EXTERNAL: "External",
  INTERNAL: "Internal",
  TECHNICAL: "Technical",
  ORGANIZATIONAL: "Organizational",
  FINANCIAL: "Financial",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// Guest links (L4): the phase words a guest sees, the owner's link-status
// words, and the milestone word for a not-yet-done milestone. Words that match
// a task status reuse it, so "Done" / "In progress" never read two ways.
export const PHASE_STATUS_LABEL: Record<PublicPhaseStatus, string> = {
  done: TASK_STATUS_LABEL.DONE,
  in_progress: TASK_STATUS_LABEL.IN_PROGRESS,
  not_started: "Not started",
};

export const SHARE_LINK_STATUS_LABEL: Record<ShareLinkStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

export const MILESTONE_UPCOMING_LABEL = "Upcoming";

// Weekly customer update. NOT_STARTED means no update was written for the
// week, so it reads "None this week" everywhere it is shown.
export const WEEKLY_STATUS_LABEL: Record<WeeklyStatus, string> = {
  NOT_STARTED: "None this week",
  DRAFT: "Draft",
  DONE: "Done",
};

// Weekly customer health (the Green/Amber/Red pill). The raw enum is upper
// case; every surface renders this word instead.
export const WEEKLY_HEALTH_LABEL: Record<WeeklyHealth, string> = {
  GREEN: "Green",
  AMBER: "Amber",
  RED: "Red",
};

export interface LabelOption<T extends string> {
  value: T;
  label: string;
}

function toOptions<T extends string>(
  labels: Record<T, string>,
): LabelOption<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({
    value,
    label: labels[value],
  }));
}

// Enum declaration order (workflow order), not alphabetical.
export const taskStatusOptions = toOptions(TASK_STATUS_LABEL);
export const priorityOptions = toOptions(PRIORITY_LABEL);
export const riskStatusOptions = toOptions(RISK_STATUS_LABEL);
export const riskCategoryOptions = toOptions(RISK_CATEGORY_LABEL);
export const projectStatusOptions = toOptions(PROJECT_STATUS_LABEL);

export type RiskLevel = "Low" | "Medium" | "High";

// Level for an already-multiplied score (probability x impact, 1-25).
export function riskLevelFromScore(score: number): RiskLevel {
  if (score <= 8) return "Low";
  if (score <= 15) return "Medium";
  return "High";
}

export function riskLevel(probability: number, impact: number): RiskLevel {
  return riskLevelFromScore(probability * impact);
}
