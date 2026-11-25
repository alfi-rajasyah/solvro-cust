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
import type { WebhookDeliveryStatus, WebhookFormat } from "@/lib/queries";
import type { ShareLinkStatus } from "@/lib/shareLinks";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

// Category group headers in the status picker (docs/archive/plans/custom-task-statuses.md
// §3 B2). The category itself still reads "To do" / "In progress" / "Done"
// (TASK_STATUS_LABEL) wherever a bare category is shown.
export const TASK_CATEGORY_GROUP_LABEL: Record<TaskStatus, string> = {
  TODO: "Not started",
  IN_PROGRESS: "Active",
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

/** The four built-in roles. */
const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  TAM: "TAM",
  STAKEHOLDER: "Stakeholder",
  PENDING: "Pending",
};

/** Words for a built-in role; a custom role (operator-entered `[A-Z0-9_]+`, e.g. "PMO") shows as stored. */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

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

// Outgoing webhooks (Settings > Integrations > Webhooks).
export const WEBHOOK_EVENT_LABEL: Record<string, string> = {
  "task.created": "Task created",
  "task.status_changed": "Task status changed",
  "task.assigned": "Task assigned",
  "task.due_date_changed": "Task due date changed",
  "task.completed": "Task completed",
  "comment.created": "Comment added",
  "project.created": "Project created",
  "risk.created": "Risk added",
};

export const WEBHOOK_FORMAT_LABEL: Record<WebhookFormat, string> = {
  STANDARD: "Standard Webhooks",
  GOOGLE_CHAT: "Google Chat",
};

export const DELIVERY_STATUS_LABEL: Record<WebhookDeliveryStatus, string> = {
  PENDING: "Pending",
  SUCCEEDED: "Delivered",
  FAILED: "Failed",
};

const DELIVERY_ERROR_LABEL: Record<string, string> = {
  owner_no_access: "The webhook owner can no longer see this project.",
  timeout: "The receiver did not answer in time.",
  connection_failed: "Could not connect to the receiver.",
  target_private: "The address points to a private network, which is not allowed.",
  target_scheme: "The address must use https.",
  target_userinfo: "The address must not contain a username or password.",
  target_invalid: "The address is not valid.",
  target_unresolvable: "The address could not be resolved.",
  internal_error: "Solvro could not send this delivery.",
  webhook_disabled: "The webhook was disabled before this was sent.",
};

/** Plain sentence for a delivery or test error code (`http_<code>` included); unknown codes get a generic line. */
export function deliveryErrorLabel(code: string): string {
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return `The receiver answered ${http[1]}.`;
  return DELIVERY_ERROR_LABEL[code] ?? "The delivery failed.";
}
