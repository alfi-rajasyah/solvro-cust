import { useCallback, useSyncExternalStore } from "react";
import {
  useInfiniteQuery,
  type InfiniteData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ApiError, apiRequest, apiRequestWithHeaders, setToken, setTokenRotating } from "./api";
import { useAuth, type Role } from "./auth";
import { dateToDay, dayFromIso, isoFromDay } from "./dateField";
import { shouldPauseRefresh, subscribeDragActivity } from "./dragActivity";
import {
  labelsFromIds,
  parseStaleWrite,
  SupersededWriteError,
  isSupersededWrite,
  type TaskExpected,
} from "./taskConflict";
import { parseWeekKey } from "./isoWeek";
import type { OutlineMentionsData } from "./outlineMentions";
import type { OutlineSnippetSegment } from "./outlineSnippet";

export type ProjectStatus =
  | "PLANNING"
  | "ACTIVE"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED";

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface UserSummary {
  id: number;
  username: string;
  email: string;
  role: Role;
  /** Inactive accounts stay in the list; pickers filter them out. */
  active: boolean;
  avatarUrl: string | null;
}

export interface Label {
  id: number;
  projectId: number;
  name: string;
  color: string;
}

export interface Section {
  id: number;
  projectId: number;
  name: string;
  position: number;
  // Hex color used as the phase track tint in the Network Diagram view.
  color: string;
  createdAt: string;
}

// Epics (Jira Epic & Story parity, docs/archive/plans/epics-spec.md §4/§5). A scope
// grouping over a project's top-level tasks — distinct from `Section`
// (phase); see the spec §2 decision record. `progress` is server-derived
// (one groupBy per list call, backend/src/routes/epics.ts) — never computed
// client-side, so a stale cache is the only way this can drift (§11 risk;
// see the epics invalidation added to every task mutation below).
export interface Epic {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  color: string;
  ownerId: number | null;
  owner: { id: number; username: string; email: string } | null;
  startDate: string | null;
  dueDate: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  progress: { done: number; total: number };
}

// GET /epics/:id — the epic detail panel's shape: the Epic fields plus its
// top-level stories, ordered by position (§5).
export interface EpicDetail extends Epic {
  tasks: Task[];
}

export interface CustomerSummary {
  id: number;
  name: string;
  accountManager: string | null;
  solutionArchitect: string | null;
  description: string;
  /** Optional http(s) link to the customer's Outline page or collection. */
  outlineUrl: string | null;
  createdAt: string;
  // TAM ownership (Decision 8, daily-review-v2-spec.md §3) — gated by
  // `project:write`, the same permission the customer form already requires.
  tamId: number | null;
  tam: { id: number; username: string } | null;
  _count: { projects: number };
  /**
   * Server-computed for the caller (GET /customers and GET /customers/:id):
   * may they reassign this customer's owner? The rule counts projects the
   * caller cannot see, which the client cannot.
   */
  canChangeOwner?: boolean;
  // GET /customers only (backend/src/routes/customers.ts): overdue tasks and
  // open risks summed over the caller's visible projects of this customer,
  // plus the weekly update filed for the current ISO week (null = none).
  health?: CustomerHealth;
}

export interface CustomerHealth {
  overdueCount: number;
  openRiskCount: number;
  weeklyUpdate: {
    weekStart: string;
    status: WeeklyStatus;
    health: WeeklyHealth | null;
  } | null;
}

export interface Service {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
}

export interface CustomerServiceAssignment {
  id: number;
  customerId: number;
  serviceId: number;
  service: Service;
  tools: string[];
  createdAt: string;
}

export interface ProjectServiceAssignment {
  id: number;
  projectId: number;
  serviceId: number;
  service: Service;
  tools: string[];
  createdAt: string;
}

export interface CustomerDetail extends CustomerSummary {
  projects: ProjectSummary[];
  services: CustomerServiceAssignment[];
}

// Per-status-column WIP cap. null (or an absent key) means "no limit".
// Visual only — see ProjectKanban's amber count-pill logic.
export interface WipLimits {
  TODO?: number | null;
  IN_PROGRESS?: number | null;
  DONE?: number | null;
}

// Server-computed health block on GET /projects, GET /projects/:id and the
// nested projects[] of GET /customers/:id (backend/src/lib/projectHealth.ts).
export interface ProjectHealth {
  /** All tasks, subtasks included. */
  progress: { done: number; total: number };
  /** Open tasks due before the caller's local day (`today`). */
  overdueCount: number;
  /** Risks with status OPEN. */
  openRiskCount: number;
  /** Earliest task start / latest task due, "yyyy-MM-dd", null when no task is dated. */
  startDate: string | null;
  endDate: string | null;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description: string | null;
  /** Optional http(s) link to the project's Outline page or collection. */
  outlineUrl: string | null;
  status: ProjectStatus;
  tamId: number;
  customerId: number | null;
  wipLimits: WipLimits | null;
  /** Administrative container (e.g. Opty Timelines) — hidden from portfolio roll-ups. */
  excludeFromPortfolio: boolean;
  baselineLockedAt: string | null;
  baselineLockedById: number | null;
  createdAt: string;
  updatedAt: string;
  tam: { id: number; username: string };
  customer: { id: number; name: string } | null;
  _count: { tasks: number };
  /** Optional so hand-built fixtures and mutation responses (bare rows) still type-check. */
  health?: ProjectHealth;
}

export interface ProjectDetail extends ProjectSummary {
  /** Present on GET /projects/:id; adds the baseline slip (whole days, null without a baseline). */
  health?: ProjectHealth & { slipDays: number | null };
  tam: { id: number; username: string; email: string; avatarUrl?: string | null };
  /** `tamId` is the customer's owner (null = unowned). */
  customer: { id: number; name: string; tamId?: number | null } | null;
  baselineLockedBy: { id: number; username: string } | null;
  services: ProjectServiceAssignment[];
}

/**
 * A user added to a project besides its TAM (GET /projects/:id/members).
 * Members have the same access as the TAM
 * (docs/archive/plans/collaboration-and-sharing.md, C1).
 */
export interface ProjectMember {
  userId: number;
  username: string;
  email: string;
  avatarUrl: string | null;
  addedAt: string;
  addedBy: { id: number; username: string } | null;
  /** Tasks in this project assigned to the member; removing them unassigns these. */
  assignedTaskCount: number;
}

export type ActivityEntityType =
  | "project"
  | "task"
  | "comment"
  | "risk"
  | "note"
  | "member"
  | "epic"
  | "share_link";
export type ActivityAction = "created" | "updated" | "deleted" | "added" | "removed";

/**
 * One row of a project's activity log (GET /projects/:id/activity). `changes`
 * is loosely typed on purpose: `{ <field>: { from, to } }` for updates,
 * `{ description: { changed: true } }`, `{ labels: { added, removed } }` — and
 * it never carries note/comment bodies or description text
 * (docs/archive/plans/collaboration-and-sharing.md, C5a). `lib/activityText.ts`
 * turns it into a sentence and tolerates any shape.
 */
export interface ActivityEvent {
  id: number;
  entityType: ActivityEntityType;
  entityId: number;
  action: ActivityAction;
  /** Display snapshot taken at write time (null for notes). */
  entityLabel: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: number; username: string; avatarUrl: string | null } | null;
}

export interface ActivityPage {
  events: ActivityEvent[];
  /** Id to pass as `before` for the next page; null on the last page. */
  nextBefore: number | null;
}


/**
 * One guest link of a project (GET /projects/:id/share-links). The server never
 * returns the token or its hash — the full link exists only in the create
 * response (docs/archive/plans/collaboration-and-sharing.md, L4).
 */
export interface ShareLink {
  id: number;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdBy: { id: number; username: string } | null;
}

/** POST /projects/:id/share-links — `url` is the `/share/<token>` link, shown once. */
export interface CreatedShareLink {
  id: number;
  label: string | null;
  url: string;
  expiresAt: string;
  createdAt: string;
}

export type PublicPhaseStatus = "done" | "in_progress" | "not_started";

/** GET /public/share/:token — the whole guest payload; nothing else is ever sent. */
export interface PublicShare {
  project: { name: string; customerName: string | null; status: ProjectStatus };
  phases: {
    name: string;
    startDate: string | null;
    endDate: string | null;
    status: PublicPhaseStatus;
  }[];
  milestones: { title: string; date: string | null; done: boolean }[];
  generatedAt: string;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  isCriticalPath: boolean;
  baselineStartDate: string | null;
  baselineDueDate: string | null;
  assignedToId: number | null;
  assignedTo: { id: number; username: string; email: string } | null;
  parentTaskId: number | null;
  sectionId: number | null;
  section: { id: number; name: string; position: number; color: string } | null;
  // Epics (Jira Epic & Story parity, docs/archive/plans/epics-spec.md §4). Only set
  // on top-level tasks — a subtask always carries `epicId: null` and
  // inherits its parent's epic for display. Always present on every task
  // payload, same rationale as `itopTicketRef` below.
  epicId: number | null;
  position: number;
  labels: Label[];
  _count: { subtasks: number; comments: number };
  // iTop ticket ref pinned to this task (Task 4.2,
  // docs/archive/plans/itop-integration.md), e.g. "R-004512" — validated by
  // the backend against `^[A-Z]{1,3}-\d{4,8}$`. Always present on every task
  // payload (list, detail, kanban, gantt), never omitted, so this is a plain
  // required field rather than optional.
  itopTicketRef: string | null;
}

export interface TaskWithProject extends Task {
  project: {
    id: number;
    name: string;
    customer: { id: number; name: string } | null;
  };
}

// GET /search response shape (backend/src/routes/search.ts). Powers the ⌘K
// command palette; deliberately excludes ProjectNote (INTERNAL-notes guardrail).
export interface SearchProjectHit {
  id: number;
  name: string;
  status: ProjectStatus;
  customerName: string | null;
}

export interface SearchTaskHit {
  id: number;
  title: string;
  status: TaskStatus;
  projectId: number;
  projectName: string;
}

export interface SearchCustomerHit {
  id: number;
  name: string;
}

export interface SearchResults {
  projects: SearchProjectHit[];
  tasks: SearchTaskHit[];
  customers: SearchCustomerHit[];
}

export interface Comment {
  id: number;
  taskId: number;
  authorId: number;
  body: string;
  createdAt: string;
  author: { id: number; username: string; email: string };
  /** Users the comment @mentions, as the server stored them (empty when none). */
  mentionedUserIds?: number[];
}

// Mirrors backend/src/lib/portfolio.ts (PortfolioProjectRow) — org-wide
// portfolio roll-up row shape shared by GET /overview and GET /reports/executive.
export interface PortfolioProjectRow {
  id: number;
  name: string;
  status: ProjectStatus;
  tamName: string;
  customerId: number | null;
  customerName: string | null;
  start: string | null;
  end: string | null;
  totalTasks: number;
  doneTasks: number;
  progressPct: number;
  isOverdue: boolean;
  daysOverdue: number;
  updatedAt: string;
  sections: { id: number; name: string; color: string }[];
}

export interface OverviewResponse {
  projectCount: number;
  projectStatusCounts: Partial<Record<ProjectStatus, number>>;
  taskCounts: Record<TaskStatus, number>;
  portfolio: PortfolioProjectRow[];
  // Open-work tiles: `overdue` = open and due before today; `dueThisWeek` =
  // open and due from today through the ISO week's Sunday; `openRisks` =
  // OPEN risks on projects in scope. Same visibility scope as the rest of
  // the response (backend/src/routes/overview.ts).
  workCounts: WorkCounts;
}

export interface WorkCounts {
  overdue: number;
  dueThisWeek: number;
  openRisks: number;
}

// GET /notes/recent — the Overview page's "Recent notes" feed
// (backend/src/routes/notes.ts). One row per note, project notes and
// operations (customer) notes merged: `project` is null for an operations
// note, `title` is null for a project note, `customer` is null for a
// project that has no customer. `noteDate` is a "T00:00:00.000Z" day
// instant — read the day via dayFromIso, never `===` against a day string.
export interface RecentNote {
  kind: "project" | "operations";
  id: number;
  noteDate: string;
  body: string;
  title: string | null;
  author: { id: number; username: string };
  project: { id: number; name: string } | null;
  customer: { id: number; name: string } | null;
  updatedAt: string;
}

export interface RecentNotesResponse {
  /** First and last calendar day of the window, "yyyy-MM-dd". */
  from: string;
  to: string;
  notes: RecentNote[];
}

export type NoteVisibility = "INTERNAL" | "CUSTOMER_FACING";

export interface ProjectNote {
  id: number;
  projectId: number;
  authorId: number;
  body: string;
  visibility: NoteVisibility;
  // The calendar day the note is logically ABOUT — distinct from
  // `createdAt` (the row's creation instant). Stored as @db.Date on the
  // backend but it ARRIVES as an ISO instant ("yyyy-MM-ddT00:00:00.000Z"),
  // never as a bare day string: always read it via `dayFromIso` before
  // comparing it to a "yyyy-MM-dd" day (see the Daily Review types below).
  noteDate: string;
  createdAt: string;
  updatedAt: string;
  author: { id: number; username: string };
}

export type WeeklyHealth = "GREEN" | "AMBER" | "RED";
export type WeeklyStatus = "NOT_STARTED" | "DRAFT" | "DONE";

export type RiskCategory =
  | "EXTERNAL"
  | "INTERNAL"
  | "TECHNICAL"
  | "ORGANIZATIONAL"
  | "FINANCIAL";

export type RiskStatus = "OPEN" | "MITIGATED" | "CLOSED";

export interface Risk {
  id: number;
  projectId: number;
  description: string;
  category: RiskCategory;
  probability: number;
  impact: number;
  status: RiskStatus;
  mitigationPlan: string | null;
  contingencyPlan: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TasksFilter {
  status?: TaskStatus;
  priority?: Priority;
  assignedToId?: number;
  labelId?: number;
  customerId?: number;
  overdue?: boolean;
  /** true = hide DONE tasks (open work only). */
  open?: boolean;
  topLevel?: boolean;
  /** Inclusive due-date day range, "yyyy-MM-dd" (the server rejects from > to). */
  dueFrom?: string;
  dueTo?: string;
  /** "due" = soonest first, undated last; default is board order. */
  sort?: "position" | "due";
}

// GET /tasks result plus the uncapped match count (`X-Total-Count`): the
// list itself stops at 200 rows, `total` says how many matched overall.
export interface TasksResult {
  tasks: TaskWithProject[];
  total: number;
}

export interface ProjectsFilter {
  customerId?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Daily Review v2 — mirrors backend/src/routes/dailyReview.ts's response
// shape 1:1 (docs/plans/daily-review-v2-spec.md §5.1). Date fields
// (`noteDate`, `weekStart`, `dueDate`, `doneAt`, `updatedAt`, `createdAt`,
// `reviewDate`) all arrive as ISO strings — the backend's `@db.Date` columns
// serialise as `T00:00:00.000Z` instants; read the calendar day via
// `dayFromIso`/`.slice(0, 10)` (dateField.ts), never `new Date(x) < today`.
// `WeeklyUpdate.midweekSavedAt` is also an ISO string but NOT one of these
// `@db.Date` columns — it's a real `DateTime` with a meaningful time-of-day
// (when the Mid-week form was saved), so a caller displaying it (e.g. "Mid-
// week saved Wed 2 Sep, 3:14 PM") should format it with `new Date(...)` in
// the viewer's local time, never slice/`dayFromIso` it like the day-only
// fields above.
// ─────────────────────────────────────────────────────────────────────────

export interface DailyReviewNote {
  id: number;
  noteDate: string;
  body: string;
  author: { id: number; username: string };
  updatedAt: string;
}

export interface DailyReviewOpsNote extends DailyReviewNote {
  // Typed manually (required, 1-120 chars, trimmed) — replaces the earlier
  // service-select field (user decision 2026-08-29, Decision 4).
  title: string;
}

// One row of the Mid-week table (docs/archive/plans/weekly-sync-highlight-rows.md
// §2 D1/D2): `WeeklyUpdate.highlights` holds one of these per highlight,
// ordered by `position`. Risk and Action live on the highlight, not on the
// week — each highlight carries its own.
export interface WeeklyHighlight {
  id: number;
  position: number;
  title: string;
  detail: string | null;
  risk: string | null;
  action: string | null;
}

// The save-side shape of a WeeklyHighlight — no `id`/`position` (the server
// assigns `position` from list order on save; see SaveWeeklyUpdateInput).
export interface WeeklyHighlightInput {
  title: string;
  detail?: string | null;
  risk?: string | null;
  action?: string | null;
}

// One Reflection achievement — one row of Monday's Reflection table
// (docs/archive/plans/weekly-sync-achievement-rows.md §2 D1/D2): `WeeklyUpdate.
// achievements` holds one of these per achievement, ordered by `position`.
// Every Reflection text belongs to the row (D2); Health and Status stay on
// the week, not the achievement.
export interface WeeklyAchievement {
  id: number;
  position: number;
  title: string;
  detail: string | null;
  outstandingIssue: string | null;
  lessonLearned: string | null;
  nextWeekFocus: string | null;
  managerDecision: string | null;
}

// The save-side shape of a WeeklyAchievement — no `id`/`position` (the
// server assigns `position` from list order on save; see
// SaveWeeklyUpdateInput).
export interface WeeklyAchievementInput {
  title: string;
  detail?: string | null;
  outstandingIssue?: string | null;
  lessonLearned?: string | null;
  nextWeekFocus?: string | null;
  managerDecision?: string | null;
}

export interface WeeklyUpdate {
  id: number;
  weekStart: string;
  health: WeeklyHealth | null;
  status: WeeklyStatus;
  doneAt: string | null;
  // Mid-week table fields (docs/archive/plans/weekly-sync-tables.md §2 D2).
  category: string | null;
  // One row per highlight (docs/archive/plans/weekly-sync-highlight-rows.md D1),
  // ordered by position — the Mid-week table lists one row per entry here.
  highlights: WeeklyHighlight[];
  // One row per Reflection achievement (docs/archive/plans/weekly-sync-
  // achievement-rows.md D1), ordered by position — the Reflection table lists one row
  // per entry here. Replaces the five flat text fields (`achievement`,
  // `outstandingIssue`, `lessonLearned`, `nextWeekFocus`, `managerDecision`)
  // this row used to carry directly (D8 moved that data onto position-0
  // achievement rows).
  achievements: WeeklyAchievement[];
  // Stamped on every save that carries at least one Mid-week field —
  // drives "Mid-week saved {date}" on the Daily Review row and Weekly Sync
  // page.
  midweekSavedAt: string | null;
  author: { id: number; username: string };
  updatedAt: string;
}

// D9/D11: last Friday's carry-over — only the achievement rows that still
// carry an open item (an Outstanding issue, a Next week focus, or a
// Manager decision), each with only the four fields the Mid-week modal's
// "From last Friday" panel shows read-only, never the full previous row.
export interface WeeklyUpdateCarryOver {
  weekStart: string;
  achievements: Pick<
    WeeklyAchievement,
    "title" | "outstandingIssue" | "nextWeekFocus" | "managerDecision"
  >[];
}

export interface DailyReviewProject {
  id: number;
  name: string;
  status: ProjectStatus;
  customerId: number | null;
  baselineLockedAt: string | null;
  phase: string;
  progress: { done: number; total: number };
  slipDays: number | null;
  // The backend filters to `dueDate !== null` before building this list
  // (routes/dailyReview.ts) — always present here, unlike Task.dueDate
  // elsewhere in this file.
  overdueTasks: { id: number; title: string; dueDate: string; status: TaskStatus }[];
  openRisks: {
    id: number;
    description: string;
    probability: number;
    impact: number;
    status: RiskStatus;
  }[];
  notes: DailyReviewNote[];
  reviews: { reviewDate: string; createdAt: string }[];
}

export interface DailyReviewCustomer {
  id: number;
  name: string;
  tam: { id: number; username: string } | null;
  projects: DailyReviewProject[];
  operationsNotes: DailyReviewOpsNote[];
  weeklyUpdate: WeeklyUpdate | null;
  // D9: the row for `weekStart − 7 days`, or null if the customer had no
  // weekly update that week. Feeds the Mid-week modal's carry-over panel.
  previousWeeklyUpdate: WeeklyUpdateCarryOver | null;
}

export interface DailyReviewResponse {
  week: { key: string; start: string; days: string[] };
  today: string;
  coverage: Record<string, { withNote: number; total: number }>;
  customers: DailyReviewCustomer[];
  unassignedProjects: DailyReviewProject[];
}

// The bare row `POST /projects/:id/reviews` returns (backend/src/routes/
// projects.ts) — distinct from DailyReviewProject's own `reviews` entries
// (which only carry reviewDate/createdAt).
export interface ProjectReviewRecord {
  id: number;
  projectId: number;
  userId: number;
  reviewDate: string;
  createdAt: string;
}

export interface ProjectNotesWindow {
  visibility?: NoteVisibility;
  limit?: number;
  from?: string;
  to?: string;
}

export const queryKeys = {
  // Outline base URL for every signed-in user (sidebar link); the admin
  // settings live under adminQueryKeys.outlineSettings.
  outlineConfig: ["outline", "config"] as const,
  // B6 (Docs tab / Settings connect): the signed-in user's Outline connection,
  // the workspace templates, and a project's / customer's page tree.
  outlineMe: ["outline", "me"] as const,
  outlineTemplates: ["outline", "templates"] as const,
  outlineDocsAll: ["outline", "docs"] as const,
  outlineDocs: (scope: OutlineDocsScope, id: number) => ["outline", "docs", scope, id] as const,
  overview: ["overview"] as const,
  users: ["users"] as const,
  projects: (filter?: ProjectsFilter) => ["projects", filter ?? {}] as const,
  project: (id: number) => ["projects", id] as const,
  projectTasks: (id: number) => ["projects", id, "tasks"] as const,
  projectLabels: (id: number) => ["projects", id, "labels"] as const,
  projectSections: (id: number) => ["projects", id, "sections"] as const,
  projectMembers: (id: number) => ["projects", id, "members"] as const,
  // Guest links (docs/archive/plans/collaboration-and-sharing.md, L4).
  projectShareLinks: (id: number) => ["projects", id, "share-links"] as const,
  // Public guest view: keyed by token, outside the ["projects", ...] tree so no
  // project invalidation ever touches it.
  publicShare: (token: string) => ["public-share", token] as const,
  // Activity log (docs/archive/plans/collaboration-and-sharing.md, C5a); the
  // person filter is part of the key so each filter pages independently.
  projectActivity: (id: number, actorId: number | null = null) =>
    ["projects", id, "activity", actorId ?? "all"] as const,
  // Epics (docs/archive/plans/epics-spec.md §5). `epic` is a standalone top-level
  // key (not nested under `projects`) since the epic detail panel/route can
  // be reached without the project already in scope — mirrors `customer`/
  // `project` above, not the `projects`-prefixed nested keys.
  projectEpics: (id: number) => ["projects", id, "epics"] as const,
  epic: (id: number) => ["epics", id] as const,
  projectRisks: (id: number) => ["projects", id, "risks"] as const,
  // `window` (visibility/limit/from/to) is appended to the key so each
  // filtered view caches independently. Mutations invalidate the whole
  // `["projects", id, "notes"]` PREFIX (see useAddProjectNote etc. below)
  // rather than this full key, so a note write refreshes every bucket, not
  // just the one a caller happens to be viewing.
  projectNotes: (id: number, window: ProjectNotesWindow = {}) =>
    [
      "projects",
      id,
      "notes",
      window.visibility ?? "all",
      window.limit ?? null,
      window.from ?? null,
      window.to ?? null,
    ] as const,
  projectDependencies: (id: number) => ["projects", id, "dependencies"] as const,
  customers: ["customers"] as const,
  customer: (id: number) => ["customers", id] as const,
  // `limit` is appended so different callers (a short "recent 3" strip vs.
  // the full history list) never share a cache entry. Mutations invalidate
  // the bare `["customers", id, "weekly-updates"]` PREFIX (see
  // useSaveWeeklyUpdate below), not this full key, for the same reason
  // `projectNotes` above documents.
  customerWeeklyUpdates: (id: number, limit?: number) =>
    ["customers", id, "weekly-updates", limit ?? null] as const,
  // Newest-first customer (operations) notes for the account Overview.
  // `customerNotesRoot` is the prefix every customer-note mutation invalidates
  // (same shape as `recentNotesRoot` below).
  customerNotesRoot: (id: number) => ["customers", id, "notes"] as const,
  customerNotes: (id: number, limit: number) =>
    [...queryKeys.customerNotesRoot(id), limit] as const,
  tasks: (filter?: TasksFilter) => ["tasks", filter ?? {}] as const,
  comments: (taskId: number) => ["tasks", taskId, "comments"] as const,
  search: (q: string) => ["search", q] as const,
  // B7: ⌘K Outline group and "Mentioned in Outline" (task panel, project Overview).
  // Prefix keys: everything a disconnect / address change must drop.
  outlineMentionsAll: ["outline", "mentions"] as const,
  outlineSearchAll: ["outline", "search"] as const,
  outlineSearch: (q: string) => ["outline", "search", q] as const,
  taskOutlineMentions: (taskId: number) => ["outline", "mentions", "task", taskId] as const,
  projectOutlineMentions: (projectId: number) =>
    ["outline", "mentions", "project", projectId] as const,
  executiveReport: () => ["executive-report"] as const,
  // `today` is folded into the key by the caller (see useDailyReview) —
  // same day-boundary rationale as useOverview/useExecutiveReport below.
  dailyReview: (week: string, today: string) => ["daily-review", week, today] as const,
  // The bare prefix every `dailyReview(...)` key extends — the
  // invalidate-everything-daily-review-related root every mutation below
  // uses, rather than ~20 repeated `["daily-review"]` array literals that
  // could each silently drift.
  dailyReviewRoot: ["daily-review"] as const,
  // Sidebar counts (GET /overview/badges). `today` is in the key — the
  // "reviewed today" judgement flips at local midnight. `navBadgesRoot` is the
  // prefix the review mutations invalidate.
  navBadges: (today: string) => ["nav-badges", today] as const,
  navBadgesRoot: ["nav-badges"] as const,
  // Overview's "Recent notes" feed (GET /notes/recent). `today` is folded
  // into the key by useRecentNotes — same day-boundary rationale as
  // useOverview. `recentNotesRoot` is the prefix every note mutation below
  // invalidates, so a note saved on the Daily Review shows up on the
  // Overview without waiting out staleTime.
  recentNotes: (today: string) => ["recent-notes", today] as const,
  recentNotesRoot: ["recent-notes"] as const,
  // Non-admin iTop reads (Task 1.8) — see the `useItopStatus`/
  // `useCustomerTickets` hooks below for the routes these back.
  // `customerTicketsRoot` is the prefix `useRequestItopRefresh` invalidates
  // after a refresh (same rationale as `recentNotesRoot` above: one root so
  // every scope/class bucket for that customer refreshes, not just the one
  // a caller happens to be viewing).
  itopStatus: ["itop", "status"] as const,
  // Personal iTop token (Task 5.2, docs/archive/plans/itop-integration.md) —
  // one row per viewer; no user id in the key since GET /itop/me/token is
  // already scoped to the caller server-side.
  myItopToken: ["itop", "me", "token"] as const,
  // Single ticket + its public/private log (Task 5.4) — distinct subtree
  // from `itopTicketByRef` below (keyed by id, not ref).
  itopTicket: (id: number) => ["itop", "tickets", id] as const,
  // Task ticket ref lookup (Task 4.2) — one entry per ref rather than a
  // customer-scoped key: a task's pinned ref may belong to a customer the
  // viewer hasn't opened, and `GET /itop/tickets/by-ref/:ref` does its own
  // visibility check (the ticket's customer), so no customer id is needed
  // in the key. `itopTicketByRefRoot` is the prefix `useRequestItopRefresh`
  // invalidates (same rationale as `customerTicketsRoot` below) — a manual
  // Refresh should also unstick a task's ticket field that was reading
  // "not in snapshot" before this pull.
  itopTicketByRefRoot: ["itop", "tickets", "by-ref"] as const,
  itopTicketByRef: (ref: string) => [...queryKeys.itopTicketByRefRoot, ref] as const,
  customerTicketsRoot: (id: number) => ["itop", "customers", id, "tickets"] as const,
  customerTickets: (id: number, scope: ItopTicketScope, cls?: ItopTicketClass) =>
    [...queryKeys.customerTicketsRoot(id), scope, cls ?? null] as const,
  // Daily Review's iTop strip (Task 2.2) — keyed by day, one fetch for the
  // whole page (see useItopDaily below), not per customer. Keyed by the
  // viewer's UTC offset too — the strip's counts bucket "today" by the
  // viewer's local day (user decision), so a DST transition or a traveling
  // viewer changing offsets must refetch rather than keep serving the
  // previous offset's bucketing.
  itopDailyRoot: ["itop", "daily"] as const,
  itopDaily: (date: string, utcOffsetMinutes: number) =>
    [...queryKeys.itopDailyRoot, date, utcOffsetMinutes] as const,
  // Utilization page (Task 3.3) — `scope` is part of the key so switching
  // Me/By TAM/By customer never serves another scope's cached rows. Keyed
  // by the viewer's UTC offset too, same rationale as `itopDaily` above.
  // `utilizationRoot` (Task 7.1) is the prefix `useLogTicketTimeFor`
  // invalidates after logging time on a ticket — same one-root-covers-every-
  // week/scope/offset-bucket rationale as `itopDailyRoot`/`customerTicketsRoot`.
  utilizationRoot: ["itop", "utilization"] as const,
  utilization: (week: string, scope: UtilizationScope, utcOffsetMinutes: number) =>
    [...queryKeys.utilizationRoot, week, scope, utcOffsetMinutes] as const,
  // New ticket sheet (Task 6.2, docs/archive/plans/itop-integration.md):
  // services are a global iTop catalogue (not customer-scoped); contacts are
  // the org's callers for one customer, so keyed by customer id.
  itopServices: ["itop", "services"] as const,
  itopContacts: (customerId: number) => ["itop", "customers", customerId, "contacts"] as const,
};

export function useOverview() {
  // The portfolio block's isOverdue/daysOverdue are badged against the
  // CALLER's local calendar day (backend/src/lib/dateBoundary.ts) — sent on
  // every request since the block is always present in the response. `today`
  // is part of the query key (not just the URL): `dateToDay(new Date())` is
  // recomputed on every render this hook runs, so the key naturally changes
  // the next time this component re-renders after local midnight — without
  // it in the key, that re-render would still hit the pre-midnight cache
  // entry instead of triggering a refetch. (An idle, non-re-rendering tab
  // keeps showing the old day's data regardless — this only fixes the key,
  // not a background timer nobody asked for.)
  const today = dateToDay(new Date())!;
  return useQuery({
    queryKey: [...queryKeys.overview, today],
    queryFn: ({ signal }) =>
      apiRequest<OverviewResponse>(`/overview?today=${today}`, { signal }),
    // The day-boundary key change (above) shouldn't flash a loading
    // skeleton on every render after midnight — keep showing the previous
    // day's data while the new key's request resolves in the background.
    placeholderData: (prev) => prev,
  });
}

// Overview's "Recent notes" panel. `today` bounds the server-side 7-day
// window and sits in the key — see useOverview for why the day is part of
// the key, not just the URL.
export function useRecentNotes() {
  const today = dateToDay(new Date())!;
  return useQuery({
    queryKey: queryKeys.recentNotes(today),
    queryFn: ({ signal }) =>
      apiRequest<RecentNotesResponse>(`/notes/recent?today=${today}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export interface NavBadgesResponse {
  // Daily Review customers with at least one ACTIVE project not yet marked
  // reviewed by the caller today.
  dailyReviewPending: number;
}

// Light sidebar counts — 60 s fresh, refetched when the tab regains focus so
// a review marked elsewhere (or a new day) shows up without a page reload.
export function useNavBadges(enabled = true) {
  const today = dateToDay(new Date())!;
  return useQuery({
    queryKey: queryKeys.navBadges(today),
    queryFn: ({ signal }) =>
      apiRequest<NavBadgesResponse>(`/overview/badges?today=${today}`, { signal }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    enabled,
  });
}

// Powers the ⌘K command palette (CommandPalette.tsx). `enabled` gates on the
// backend's own 2-char minimum (search.ts's Zod schema) so we never fire a
// request that's guaranteed to 400. `placeholderData` keeps the previous
// page of results rendered while the next keystroke's query is in flight —
// prevents the list flashing empty on every char.
export function useSearch(q: string, allowed = true) {
  return useQuery<SearchResults>({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) =>
      apiRequest<SearchResults>(`/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: allowed && q.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: ({ signal }) => apiRequest<UserSummary[]>("/users", { signal }),
    staleTime: 60_000,
    enabled,
  });
}

export function useProjects(filter: ProjectsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.customerId) params.set("customerId", String(filter.customerId));
  // `health.overdueCount` is bucketed against the caller's local day, so
  // `today` rides along in the URL and the key (same reasoning as useTasks):
  // the key rolls over with the day instead of serving a pre-midnight entry.
  const today = dateToDay(new Date())!;
  params.set("today", today);
  const qs = params.toString();
  return useQuery({
    queryKey: [...queryKeys.projects(filter), today],
    queryFn: ({ signal }) =>
      apiRequest<ProjectSummary[]>(`/projects${qs ? `?${qs}` : ""}`, { signal }),
  });
}

// Shared-editing freshness (docs/archive/plans/collaboration-and-sharing.md,
// C3a): several TAMs edit the same projects, so the project-scoped queries the
// List/Kanban/Gantt/Epics/detail views read refetch on window focus and every
// 30 s while the tab is visible (`refetchIntervalInBackground: false`).
// Applied per hook, NOT via main.tsx's global defaults — those also govern the
// iTop and admin queries, which must not start polling. Both the interval and
// the focus refetch hold off while a board/Gantt/list drag is live or any
// mutation is pending (`isMutating() > 0`), so a refetch never moves a card
// under the cursor or overwrites an optimistic write. The pause is any
// mutation, app-wide, not just project ones: mutations carry no keys to scope
// on, they are short, and polling resumes the moment the last one settles.
//
// Timing trap: query-core evaluates `refetchInterval` only when the query
// updates or the observer's options are re-set — never when the timer fires,
// and a `false` is never re-armed by itself. So `useLiveRefresh` subscribes to
// the drag store and the mutation cache and re-renders when the gate flips;
// that re-render re-sets the options, which clears the timer on pause and
// re-arms it on resume. The function forms below keep reading live state so
// the gate is also right at every evaluation in between. Focus refetch still
// only fires on stale data (the global 30 s `staleTime`).
export const LIVE_REFRESH_MS = 30_000;
export function subscribeRefreshGate(
  qc: Pick<QueryClient, "getMutationCache">,
  listener: () => void,
): () => void {
  const offDrag = subscribeDragActivity(listener);
  const offMutations = qc.getMutationCache().subscribe(listener);
  return () => {
    offDrag();
    offMutations();
  };
}
export function liveRefreshOptions(qc: Pick<QueryClient, "isMutating">) {
  return {
    refetchOnWindowFocus: () => !shouldPauseRefresh(qc.isMutating()),
    refetchInterval: () =>
      shouldPauseRefresh(qc.isMutating()) ? (false as const) : LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
  };
}
export function useLiveRefresh() {
  const qc = useQueryClient();
  // Stable callbacks so React does not re-subscribe on every render. Snapshot
  // is a boolean, so a consumer re-renders only when the gate flips.
  const subscribe = useCallback(
    (listener: () => void) => subscribeRefreshGate(qc, listener),
    [qc],
  );
  const getSnapshot = useCallback(() => shouldPauseRefresh(qc.isMutating()), [qc]);
  useSyncExternalStore(subscribe, getSnapshot);
  return liveRefreshOptions(qc);
}

export function useCustomers(enabled = true) {
  // `health.overdueCount` depends on the caller's local day — see useProjects.
  // The day is appended to the key (the bare ["customers"] prefix that
  // mutations invalidate still matches it).
  const today = dateToDay(new Date())!;
  return useQuery({
    queryKey: [...queryKeys.customers, today],
    queryFn: ({ signal }) =>
      apiRequest<CustomerSummary[]>(`/customers?today=${today}`, { signal }),
    staleTime: 30_000,
    enabled,
  });
}

export function useCustomer(id: number | null) {
  // Nested projects[] carry `health`, whose overdue count depends on `today`
  // — see useProjects.
  const today = dateToDay(new Date())!;
  const live = useLiveRefresh();
  return useQuery({
    ...live,
    queryKey: id ? [...queryKeys.customer(id), today] : ["customers", "noop"],
    queryFn: ({ signal }) =>
      apiRequest<CustomerDetail>(`/customers/${id}?today=${today}`, { signal }),
    enabled: id !== null,
  });
}

export function useProject(id: number | null) {
  // `health.overdueCount` depends on the caller's local day — see useProjects.
  const today = dateToDay(new Date())!;
  const live = useLiveRefresh();
  return useQuery({
    ...live,
    queryKey: id ? [...queryKeys.project(id), today] : ["projects", "noop"],
    queryFn: ({ signal }) =>
      apiRequest<ProjectDetail>(`/projects/${id}?today=${today}`, { signal }),
    enabled: id !== null,
  });
}

export function useProjectTasks(id: number | null) {
  const live = useLiveRefresh();
  return useQuery({
    ...live,
    queryKey: id ? queryKeys.projectTasks(id) : ["projects", "noop", "tasks"],
    queryFn: ({ signal }) =>
      apiRequest<Task[]>(`/projects/${id}/tasks`, { signal }),
    enabled: id !== null,
  });
}

export function useProjectMembers(projectId: number | null) {
  const live = useLiveRefresh();
  return useQuery({
    ...live,
    queryKey: projectId ? queryKeys.projectMembers(projectId) : ["projects", "noop", "members"],
    queryFn: ({ signal }) =>
      apiRequest<ProjectMember[]>(`/projects/${projectId}/members`, { signal }),
    enabled: projectId !== null,
  });
}

export function useShareLinks(projectId: number | null, enabled = true) {
  return useQuery({
    queryKey: projectId ? queryKeys.projectShareLinks(projectId) : ["projects", "noop", "share-links"],
    queryFn: ({ signal }) =>
      apiRequest<ShareLink[]>(`/projects/${projectId}/share-links`, { signal }),
    enabled: projectId !== null && enabled,
  });
}

export function useCreateShareLink(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { label?: string; expiresInDays?: number }) =>
      apiRequest<CreatedShareLink>(`/projects/${projectId}/share-links`, {
        method: "POST",
        body: input,
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectShareLinks(projectId) });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export function useRevokeShareLink(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: number) =>
      apiRequest<void>(`/projects/${projectId}/share-links/${linkId}`, { method: "DELETE" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectShareLinks(projectId) });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

/**
 * The public guest view. Sent WITHOUT the Authorization header (`auth: false`)
 * so a signed-in visitor is treated like any guest; `apiRequest` never signs
 * anyone out on a 401 (only AuthProvider's own /auth/me call does), so a failed
 * public read cannot redirect. 404 (expired/revoked/unknown) and 429 are final
 * answers, so there is no retry.
 */
export function usePublicShare(token: string | undefined) {
  return useQuery({
    queryKey: queryKeys.publicShare(token ?? ""),
    queryFn: ({ signal }) =>
      apiRequest<PublicShare>(`/public/share/${encodeURIComponent(token ?? "")}`, {
        signal,
        auth: false,
      }),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export const ACTIVITY_PAGE_SIZE = 20;
export const ACTIVITY_MAX_PAGES = 5;

/** Newest-first activity, paged by the `before` event id; `actorId` narrows to one person. */
export function useProjectActivity(
  projectId: number | null,
  { actorId = null }: { actorId?: number | null } = {},
) {
  const live = useLiveRefresh();
  return useInfiniteQuery({
    ...live,
    queryKey: projectId
      ? queryKeys.projectActivity(projectId, actorId)
      : ["projects", "noop", "activity"],
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: String(ACTIVITY_PAGE_SIZE) });
      if (pageParam !== null) params.set("before", String(pageParam));
      if (actorId !== null) params.set("actorId", String(actorId));
      return apiRequest<ActivityPage>(`/projects/${projectId}/activity?${params}`, { signal });
    },
    initialPageParam: null as number | null,
    // Every refetch (30 s tick, invalidation) re-walks all loaded pages one
    // after another, so the log stops offering "Load more" after
    // ACTIVITY_MAX_PAGES pages (100 events). React Query's `maxPages` is not
    // used: it evicts the FIRST (newest) page when paging forward, which would
    // drop the latest events off the top of the list.
    getNextPageParam: (last, all) =>
      all.length >= ACTIVITY_MAX_PAGES ? undefined : last.nextBefore,
    enabled: projectId !== null,
  });
}

// ---- In-app notifications (docs/archive/plans/collaboration-and-sharing.md, C5b)

export type NotificationReason = "assigned" | "commented" | "mentioned";

export interface AppNotification {
  id: number;
  reason: NotificationReason;
  readAt: string | null;
  createdAt: string;
  event: ActivityEvent;
  projectId: number;
  projectName: string;
}

export interface NotificationsPage {
  notifications: AppNotification[];
  nextBefore: number | null;
}

export const NOTIFICATIONS_PAGE_SIZE = 30;
const NOTIFICATIONS_LIST_KEY = ["notifications", "list"] as const;
const NOTIFICATIONS_COUNT_KEY = ["notifications", "unread-count"] as const;

/**
 * Unread badge count. Polls every 60 s while the tab is visible and refetches
 * on focus (`staleTime: 0` so a focus always asks the server).
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: NOTIFICATIONS_COUNT_KEY,
    queryFn: ({ signal }) =>
      apiRequest<{ count: number }>("/notifications/unread-count", { signal }).then((r) => r.count),
    staleTime: 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/** Newest-first notifications, paged by the `before` id; mount it only while the list is open. */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: NOTIFICATIONS_LIST_KEY,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ limit: String(NOTIFICATIONS_PAGE_SIZE) });
      if (pageParam !== null) params.set("before", String(pageParam));
      return apiRequest<NotificationsPage>(`/notifications?${params}`, { signal });
    },
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
    staleTime: 0,
  });
}

function invalidateNotifications(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: NOTIFICATIONS_LIST_KEY }),
    qc.invalidateQueries({ queryKey: NOTIFICATIONS_COUNT_KEY }),
  ]);
}

type NotificationsData = InfiniteData<NotificationsPage, number | null>;

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<{ id: number; readAt: string }>(`/notifications/${id}/read`, { method: "POST" }),
    // Optimistic: the badge and the row flip at once; a failed write rolls back.
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: NOTIFICATIONS_LIST_KEY }),
        qc.cancelQueries({ queryKey: NOTIFICATIONS_COUNT_KEY }),
      ]);
      const prevList = qc.getQueryData<NotificationsData>(NOTIFICATIONS_LIST_KEY);
      const prevCount = qc.getQueryData<number>(NOTIFICATIONS_COUNT_KEY);
      const wasUnread = prevList?.pages.some((p) =>
        p.notifications.some((n) => n.id === id && n.readAt === null),
      );
      const now = new Date().toISOString();
      if (prevList) {
        qc.setQueryData<NotificationsData>(NOTIFICATIONS_LIST_KEY, {
          ...prevList,
          pages: prevList.pages.map((p) => ({
            ...p,
            notifications: p.notifications.map((n) =>
              n.id === id && n.readAt === null ? { ...n, readAt: now } : n,
            ),
          })),
        });
      }
      if (wasUnread && prevCount !== undefined) {
        qc.setQueryData<number>(NOTIFICATIONS_COUNT_KEY, Math.max(0, prevCount - 1));
      }
      return { prevList, prevCount };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevList) qc.setQueryData(NOTIFICATIONS_LIST_KEY, ctx.prevList);
      if (ctx?.prevCount !== undefined) qc.setQueryData(NOTIFICATIONS_COUNT_KEY, ctx.prevCount);
    },
    onSettled: () => {
      invalidateNotifications(qc);
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    onSettled: () => {
      invalidateNotifications(qc);
    },
  });
}

// Membership changes what the caller (and the member) can see, so beyond the
// members list they refresh the project lists and this project's detail —
// the same health-carrying queries a task write refreshes.
export function useAddProjectMember(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) =>
      apiRequest<ProjectMember>(`/projects/${projectId}/members`, {
        method: "POST",
        body: { userId },
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export function useRemoveProjectMember(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) =>
      apiRequest<void>(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: queryKeys.projectMembers(projectId) });
      const prev = qc.getQueryData<ProjectMember[]>(queryKeys.projectMembers(projectId));
      if (prev) {
        qc.setQueryData<ProjectMember[]>(
          queryKeys.projectMembers(projectId),
          prev.filter((m) => m.userId !== userId),
        );
      }
      return { prev };
    },
    onError: (_err, _userId, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.projectMembers(projectId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
      // The server unassigns the removed member's tasks in the same
      // transaction, so every task view of this project is stale.
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export function useProjectLabels(id: number | null) {
  return useQuery({
    queryKey: id ? queryKeys.projectLabels(id) : ["projects", "noop", "labels"],
    queryFn: ({ signal }) =>
      apiRequest<Label[]>(`/projects/${id}/labels`, { signal }),
    enabled: id !== null,
    staleTime: 30_000,
  });
}

// Task and risk writes move the server-computed `health` numbers (progress,
// overdue, open risks) shown on project and customer surfaces. Only the
// queries that carry `health` are refreshed — never the bare "projects" /
// "customers" prefixes, which would also refetch every per-project subquery
// (tasks, sections, labels, epics, risks, notes, …) and the customer
// weekly-updates / notes caches on each drag or inline edit. Those queries
// are told apart by key shape: `useProjects` = ["projects", {filter}, today],
// `useProject` = ["projects", id, today], `useCustomers` = ["customers",
// today], `useCustomer` = ["customers", id, today]; subquery keys carry a
// non-day string or extra segments instead.
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDayKey = (v: unknown): boolean => typeof v === "string" && DAY_KEY_RE.test(v);

// Every write the activity log records refreshes the log at once (all person
// filters, via the key prefix).
function invalidateProjectActivity(qc: QueryClient, projectId: number) {
  return qc.invalidateQueries({
    predicate: ({ queryKey: k }) =>
      k[0] === "projects" &&
      k[2] === "activity" &&
      k[1] === projectId,
  });
}

function invalidateProjectHealth(qc: QueryClient, projectId: number) {
  return Promise.all([
    qc.invalidateQueries({
      predicate: ({ queryKey: k }) =>
        k[0] === "projects" &&
        // project lists, or this project's detail
        (typeof k[1] === "object" ||
          (k[1] === projectId && k.length === 3 && isDayKey(k[2]))),
    }),
    qc.invalidateQueries({
      predicate: ({ queryKey: k }) =>
        k[0] === "customers" &&
        // customers list, or any customer detail (a task write doesn't know
        // its project's customer; only mounted detail queries refetch)
        ((k.length === 2 && isDayKey(k[1])) ||
          (typeof k[1] === "number" && k.length === 3 && isDayKey(k[2]))),
    }),
  ]);
}

function tasksQueryOptions(filter: TasksFilter) {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.priority) params.set("priority", filter.priority);
  if (filter.assignedToId) params.set("assignedToId", String(filter.assignedToId));
  if (filter.labelId) params.set("labelId", String(filter.labelId));
  if (filter.customerId) params.set("customerId", String(filter.customerId));
  if (filter.overdue) {
    params.set("overdue", "true");
    // The server badges "overdue" against the CALLER's local calendar day,
    // falling back to its own UTC day when `today` is absent — see
    // backend/src/lib/dateBoundary.ts. Sent only when the overdue filter
    // itself is active; `today` isn't a TasksFilter option callers set.
    params.set("today", dateToDay(new Date())!);
  }
  if (filter.open) params.set("open", "true");
  if (filter.topLevel) params.set("topLevel", "true");
  if (filter.dueFrom) params.set("dueFrom", filter.dueFrom);
  if (filter.dueTo) params.set("dueTo", filter.dueTo);
  if (filter.sort) params.set("sort", filter.sort);
  const qs = params.toString();
  return {
    // `qs` (not just `filter`) is part of the key: `today` lives only in
    // `qs`, recomputed fresh each render this hook runs, so the key
    // naturally changes the next time the component re-renders after local
    // midnight — without it in the key, that re-render would still hit the
    // pre-midnight cache entry for an unchanged `{overdue:true}` filter
    // instead of refetching against the new day.
    queryKey: [...queryKeys.tasks(filter), qs],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<TasksResult> => {
      const { data, headers } = await apiRequestWithHeaders<TaskWithProject[]>(
        `/tasks${qs ? `?${qs}` : ""}`,
        { signal },
      );
      // Header missing (older server, stripped by a proxy): fall back to the
      // length of what we received rather than NaN.
      const header = Number(headers.get("X-Total-Count"));
      const total = headers.has("X-Total-Count") && Number.isFinite(header) ? header : data.length;
      return { tasks: data, total };
    },
    // See useOverview()'s comment: avoids a skeleton flash on the render
    // where the day-boundary key change lands.
    placeholderData: (prev: TasksResult | undefined) => prev,
  };
}

const selectTasks = (r: TasksResult) => r.tasks;

// The task list alone (`data` is the array). Shares its cache entry with
// useTasksWithTotal — same key, same stored `{ tasks, total }` shape.
export function useTasks(filter: TasksFilter = {}) {
  return useQuery({ ...tasksQueryOptions(filter), select: selectTasks });
}

// The task list plus the uncapped match count, for "showing 200 of N".
export function useTasksWithTotal(filter: TasksFilter = {}) {
  return useQuery(tasksQueryOptions(filter));
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  /** Optional http(s) link to the project's Outline page; null for none. Validated server-side. */
  outlineUrl?: string | null;
  tamId?: number;
  customerId: number;
  status?: ProjectStatus;
  wipLimits?: WipLimits | null;
  excludeFromPortfolio?: boolean;
}

// The bare row `prisma.project.create` returns (backend/src/routes/
// projects.ts's POST "/") — no `tam`/`customer`/`_count`, unlike
// `ProjectSummary`, which only reflects GET
// /projects's own `include`. `ProjectSummary` was mistyped here (finding
// N5): nothing currently reads more than `.id` off this result, so it
// never surfaced as a runtime bug, but a caller trusting the type to read
// e.g. `.tam.username` off a freshly-created project would silently get
// `undefined` with no type error to catch it.
export type CreatedProject = Omit<ProjectSummary, "tam" | "customer" | "_count">;

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiRequest<CreatedProject>("/projects", { method: "POST", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      // A brand-new project always changes the executive portfolio
      // roll-up too (finding S1, pre-existing gap) — every project counts
      // toward it by default (`excludeFromPortfolio` starts `false` unless
      // the create form opts out), so a create needs this invalidation the
      // same way `useUpdateProject` below already invalidates it on an
      // `excludeFromPortfolio` flip. Without this, a newly created project
      // wouldn't show up on the Executive dashboard until *something else*
      // happened to invalidate `executiveReport`.
      qc.invalidateQueries({ queryKey: queryKeys.executiveReport() });
    },
  });
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  outlineUrl?: string | null;
  status?: ProjectStatus;
  tamId?: number;
  customerId?: number;
  wipLimits?: WipLimits | null;
  excludeFromPortfolio?: boolean;
}

export function useUpdateProject(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      apiRequest<ProjectSummary>(`/projects/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: queryKeys.project(id) });
      invalidateProjectActivity(qc, id);
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      // excludeFromPortfolio changes reshape the executive roll-up too.
      qc.invalidateQueries({ queryKey: queryKeys.executiveReport() });
      // The Docs tab resolves the project's Outline link: a changed link must not
      // keep showing the old page tree.
      qc.invalidateQueries({ queryKey: queryKeys.outlineDocs("projects", id) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiRequest<void>(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      // The project is gone: drop its own cache subtree instead of refetching
      // it into 404s, then refresh everything that listed or counted it or
      // its cascaded tasks.
      qc.removeQueries({ queryKey: queryKeys.project(id) });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: adminQueryKeys.projects });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      qc.invalidateQueries({ queryKey: queryKeys.executiveReport() });
    },
  });
}

export interface CustomerInput {
  name: string;
  accountManager?: string;
  solutionArchitect?: string;
  description: string;
  outlineUrl?: string | null;
  // TAM ownership gate is `project:write` (Decision 8) — the same
  // permission this form already requires to submit; there's no
  // `customer:write`. Nullable to support unassigning.
  tamId?: number | null;
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) =>
      apiRequest<CustomerSummary>("/customers", { method: "POST", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      // A new customer's `tamId` can put it straight into the Daily
      // Review page's customer scope (Decision 14).
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
    },
  });
}

export function useUpdateCustomer(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CustomerInput>) =>
      apiRequest<CustomerSummary>(`/customers/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      qc.invalidateQueries({ queryKey: queryKeys.customer(id) });
      // Reassigning `tamId` can add or remove this customer from the Daily
      // Review page's customer scope (Decision 14).
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      // Same for the customer Docs tab and its Outline link.
      qc.invalidateQueries({ queryKey: queryKeys.outlineDocs("customers", id) });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useServices() {
  return useQuery({
    queryKey: ["services"] as const,
    queryFn: ({ signal }) => apiRequest<Service[]>("/services", { signal }),
    staleTime: 60_000,
  });
}

export interface ServiceInput {
  name: string;
  description?: string;
  active?: boolean;
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ServiceInput) =>
      apiRequest<Service>("/services", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ServiceInput> }) =>
      apiRequest<Service>(`/services/${id}`, { method: "PATCH", body: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/services/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export interface ServiceAssignmentInput {
  serviceId: number;
  tools: string[];
}

export function useUpdateCustomerServices(customerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignments: ServiceAssignmentInput[]) =>
      apiRequest<CustomerDetail>(`/customers/${customerId}/services`, {
        method: "PUT",
        body: { assignments },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.customer(customerId) });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
    },
  });
}

export function useUpdateProjectServices(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignments: ServiceAssignmentInput[]) =>
      apiRequest<ProjectDetail>(`/projects/${projectId}/services`, {
        method: "PUT",
        body: { assignments },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
  isCriticalPath?: boolean;
  baselineStartDate?: string | null;
  baselineDueDate?: string | null;
  assignedToId?: number | null;
  parentTaskId?: number | null;
  sectionId?: number | null;
  labelIds?: number[];
  position?: number;
  itopTicketRef?: string | null;
  // Epics (docs/archive/plans/epics-spec.md §4/§5). Backend rejects this on a task
  // that has (or is being given) a `parentTaskId` — 400 `epic_on_subtask`.
  epicId?: number | null;
}

export interface LockBaselineInput {
  asOfDate?: string | null;
  clear?: boolean;
}

export function useLockBaseline(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LockBaselineInput = {}) =>
      apiRequest<ProjectDetail>(`/projects/${projectId}/baseline`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// Mirrors the server's sibling-list semantics (backend/src/lib/taskOrdering.ts)
// so the optimistic cache update produces the exact same ordering the PATCH
// response will settle to — this is what keeps drag-and-drop flicker-free.
// A sibling list is: every top-level task in the project (one canonical
// order — List/Kanban/Gantt each render a filtered/grouped view of it), or
// "the parent's subtasks" for subtasks. Status never partitions ordering
// anywhere; a status-only change keeps the row's slot.
function siblingListId(t: Pick<Task, "parentTaskId" | "status">): string {
  return t.parentTaskId === null ? "top" : `sub:${t.parentTaskId}`;
}

/**
 * Reorders/re-parents `id` inside a locally-cached task list exactly the way
 * the backend's moveTaskWithinSiblings does: remove from the old sibling
 * list (re-packing it), then insert into the new sibling list at the
 * clamped requested index (re-packing that too). Returns a new array;
 * doesn't mutate `tasks`.
 *
 * `sectionId` is carried into the merged task too (though it never affects
 * sibling-list membership — see `siblingListId`): a List-view cross-section
 * drop patches `{ sectionId, position }` together, and without this the
 * optimistic row would sit under its old section until the server response
 * settles.
 */
export function reorderTasksLocally(
  tasks: Task[],
  id: number,
  patch: Pick<UpdateTaskInput, "status" | "parentTaskId" | "position" | "sectionId">,
): Task[] {
  const current = tasks.find((t) => t.id === id);
  if (!current) return tasks;

  const nextStatus = patch.status ?? current.status;
  const nextParentTaskId =
    patch.parentTaskId !== undefined ? patch.parentTaskId : current.parentTaskId;
  const nextSectionId =
    patch.sectionId !== undefined ? patch.sectionId : current.sectionId;
  const updatedTask: Task = {
    ...current,
    status: nextStatus,
    parentTaskId: nextParentTaskId,
    sectionId: nextSectionId,
    // Mirror the backend: re-parenting under a parent clears epicId in the
    // same transaction (§4) — a subtask never carries its own epic link.
    epicId: nextParentTaskId !== null ? null : current.epicId,
  };

  const oldListId = siblingListId(current);
  const newListId = siblingListId(updatedTask);

  // Every other task, grouped by which sibling list it's currently in.
  const byList = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.id === id) continue;
    const key = siblingListId(t);
    const arr = byList.get(key) ?? [];
    arr.push(t);
    byList.set(key, arr);
  }
  for (const arr of byList.values()) arr.sort((a, b) => a.position - b.position || a.id - b.id);

  const newSiblings = [...(byList.get(newListId) ?? [])];
  const clamped =
    patch.position === undefined
      ? newSiblings.length
      : Math.max(0, Math.min(patch.position, newSiblings.length));
  newSiblings.splice(clamped, 0, updatedTask);

  // Re-pack positions for both the old list (gap closed) and the new list
  // (insertion applied). If old === new, newSiblings already covers it.
  const repacked = new Map<number, number>();
  newSiblings.forEach((t, i) => repacked.set(t.id, i));
  if (oldListId !== newListId) {
    (byList.get(oldListId) ?? []).forEach((t, i) => repacked.set(t.id, i));
  }

  return tasks.map((t) => {
    if (t.id === id) return { ...updatedTask, position: repacked.get(id) ?? updatedTask.position };
    if (repacked.has(t.id)) return { ...t, position: repacked.get(t.id)! };
    return t;
  });
}

// One save per task at a time: a second save of the same task waits for the
// first to commit (its optimistic write still lands immediately). Without it,
// two quick edits race, and the second's `expected` — read from the first's
// optimistic state — can reach the server before the first is applied and come
// back as a false 409. Keyed by task id only, so different tasks (a subtask, a
// board drag elsewhere) never wait on each other.
const taskWriteTails = new Map<number, Promise<unknown>>();
// A save refused with `stale_write` invalidates every save of that task that
// was already queued behind it AND carried an `expected`: those were built on
// top of the rejected edit's optimistic state, so they would just conflict
// with themselves and replace the first dialog. They are dropped unsent
// (SupersededWriteError) — simpler and safer than re-deriving `expected`,
// since the user has not yet chosen between theirs and mine. Saves without an
// `expected` (board drags, toggles) are unaffected, and so is anything queued
// after the failure (sequence number above the recorded one).
let taskWriteSeq = 0;
const taskStaleAt = new Map<number, number>();

function serialiseTaskWrite<T>(
  id: number,
  hasExpected: boolean,
  run: () => Promise<T>,
): Promise<T> {
  const seq = ++taskWriteSeq;
  const result = (taskWriteTails.get(id) ?? Promise.resolve()).then(async () => {
    if (hasExpected && seq <= (taskStaleAt.get(id) ?? 0)) throw new SupersededWriteError();
    try {
      return await run();
    } catch (err) {
      if (parseStaleWrite(err)) taskStaleAt.set(id, taskWriteSeq);
      throw err;
    }
  });
  const tail = result.catch(() => undefined);
  taskWriteTails.set(id, tail);
  void tail.then(() => {
    if (taskWriteTails.get(id) === tail) {
      taskWriteTails.delete(id);
      taskStaleAt.delete(id);
    }
  });
  return result;
}

export function useUpdateTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateTask", projectId],
    // `expected` (optional) is the value the caller last saw for each field in
    // `patch`; the server then answers 409 `stale_write` (see `parseStaleWrite`
    // in lib/taskConflict.ts) if someone changed one of those fields since.
    // Board/List/Gantt edits pass none and stay last-write-wins. It travels in
    // the body only — the optimistic write below never sees it.
    mutationFn: ({
      id,
      patch,
      expected,
    }: {
      id: number;
      patch: UpdateTaskInput;
      expected?: TaskExpected;
    }) =>
      serialiseTaskWrite(id, expected !== undefined, () =>
        apiRequest<Task>(`/tasks/${id}`, {
          method: "PATCH",
          body: expected ? { ...patch, expected } : patch,
        }),
      ),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.projectTasks(projectId) });
      const prev = qc.getQueryData<Task[]>(queryKeys.projectTasks(projectId));
      const current = prev?.find((t) => t.id === id);
      if (prev) {
        // Mirror the server's rule (backend/src/routes/tasks.ts): a patch only
        // re-orders when it sets an explicit position or moves the task to a
        // different sibling list. A status-only change on a subtask does NOT
        // reorder — its sibling list is keyed on parentTaskId alone — so it
        // must fall through to a plain field merge, not reorderTasksLocally
        // (which would re-append the row to the end of its list).
        const listChanged =
          current !== undefined &&
          siblingListId(current) !==
            siblingListId({
              parentTaskId:
                patch.parentTaskId !== undefined ? patch.parentTaskId : current.parentTaskId,
              status: patch.status ?? current.status,
            });
        const touchesOrdering = patch.position !== undefined || listChanged;
        const next = touchesOrdering
          ? reorderTasksLocally(prev, id, patch)
          : prev.map((t) =>
              t.id === id
                ? ({
                    ...t,
                    ...patch,
                    // Same server mirror as reorderTasksLocally above, for
                    // whichever plain-merge patch also touches parentTaskId.
                    ...(patch.parentTaskId != null ? { epicId: null } : {}),
                  } as Task)
                : t,
            );
        // `labelIds` in the patch must land on `labels` too — that is what the
        // panel's chips and its next `expected` read.
        const withLabels =
          patch.labelIds === undefined
            ? next
            : next.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      labels: labelsFromIds(
                        patch.labelIds!,
                        qc.getQueryData<Label[]>(queryKeys.projectLabels(projectId)),
                        t.labels,
                        projectId,
                      ),
                    }
                  : t,
              );
        qc.setQueryData<Task[]>(queryKeys.projectTasks(projectId), withLabels);
      }
      return { prev, prevEpicId: current?.epicId ?? null };
    },
    onError: (err, _vars, ctx) => {
      // A dropped save never changed anything; the refused save before it has
      // already rolled the cache back, and the last save to settle refetches.
      if (isSupersededWrite(err)) return;
      if (ctx?.prev)
        qc.setQueryData(queryKeys.projectTasks(projectId), ctx.prev);
    },
    onSettled: (data, err, { patch }, ctx) => {
      // While another save is still in flight (this one still counts, hence
      // > 1) skip the task-list refetch: it would return the server's
      // in-between state and overwrite the pending optimistic edit, and the
      // last save to settle refetches anyway. A refused (`stale_write`) or
      // dropped save is the exception: its rollback must always be followed by
      // a refetch, whatever else is queued, so the cache repairs from the
      // server rather than depending on settle order.
      const mustRefetch = parseStaleWrite(err) !== null || isSupersededWrite(err);
      if (
        mustRefetch ||
        qc.isMutating({ mutationKey: ["updateTask", projectId] }) <= 1
      ) {
        qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      }
      // Assigning a non-member adds them to the project server-side
      // (collaboration plan C2) — refresh the header's member list.
      if (patch.assignedToId != null) {
        qc.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
      }
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
      // The Daily Review page's attention lists let a TAM change a task's
      // status inline (daily-review-v2-spec.md §6.3) — keep that cache in
      // sync too.
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      // Epic progress (done/total) derives from task status + epicId (§4) —
      // any update here (status flip, epic reassignment, or a reorder that
      // crosses sibling lists) can change it, so the epics list always
      // refetches (§11 risk). The individual epic-detail cache only needs a
      // bust for the epic(s) this task actually touched: the one it left
      // and/or the one it landed in.
      qc.invalidateQueries({ queryKey: queryKeys.projectEpics(projectId) });
      const prevEpicId = ctx?.prevEpicId ?? null;
      // Prefer the mutation response over the patch/cache: `prevEpicId` (and
      // an epicId-less patch) can both be wrong when `projectTasks` was
      // never populated for this project — e.g. an edit made from the
      // Epics tab, which only ever fetches useEpic, not useProjectTasks.
      // The server response always carries the task's actual epicId, so
      // fall back to the patch/cache only on error (no `data`).
      const nextEpicId = data
        ? data.epicId
        : patch.epicId !== undefined
          ? patch.epicId
          : prevEpicId;
      if (prevEpicId !== null) {
        qc.invalidateQueries({ queryKey: queryKeys.epic(prevEpicId) });
      }
      if (nextEpicId !== null && nextEpicId !== prevEpicId) {
        qc.invalidateQueries({ queryKey: queryKeys.epic(nextEpicId) });
      }
    },
  });
}

export function useDeleteTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/tasks/${id}`, { method: "DELETE" }),
    // Read-only onMutate (no optimistic write) purely to capture the
    // deleted task's epicId before it's gone from cache, for the epic
    // invalidation in onSuccess below.
    onMutate: (id) => {
      const prev = qc.getQueryData<Task[]>(queryKeys.projectTasks(projectId));
      return { epicId: prev?.find((t) => t.id === id)?.epicId ?? null };
    },
    onSuccess: (_data, _id, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
      // Same rationale as useUpdateTask above — a deleted task can drop out
      // of the Daily Review page's overdue-tasks attention list.
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      // A deleted task drops out of its epic's done/total count (§11 risk).
      qc.invalidateQueries({ queryKey: queryKeys.projectEpics(projectId) });
      if (ctx?.epicId !== null && ctx?.epicId !== undefined) {
        qc.invalidateQueries({ queryKey: queryKeys.epic(ctx.epicId) });
      } else {
        // projectTasks was cold when this delete started (e.g. deleted from
        // the Epics tab, which never populates it), so the deleted task's
        // epicId is unknown — bust every open epic-detail cache rather than
        // silently skip the invalidation. ["epics"] is a prefix match, so
        // this covers every queryKeys.epic(id) entry.
        qc.invalidateQueries({ queryKey: ["epics"] });
      }
    },
  });
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
  isCriticalPath?: boolean;
  assignedToId?: number | null;
  parentTaskId?: number | null;
  sectionId?: number | null;
  labelIds?: number[];
  // Epics (docs/archive/plans/epics-spec.md §4/§5) — only meaningful for a
  // top-level task; the backend rejects it alongside `parentTaskId`.
  epicId?: number | null;
}

export function useCreateTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiRequest<Task>(`/projects/${projectId}/tasks`, {
        method: "POST",
        body: input,
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
      // Same as useUpdateTask: an assignee who is not yet a member becomes one.
      if (variables.assignedToId != null) {
        qc.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
      }
      // A new task can be created directly under an epic (§6 "Add story…"
      // inline create) — keep that epic's progress (done/total) in sync.
      qc.invalidateQueries({ queryKey: queryKeys.projectEpics(projectId) });
      if (variables.epicId !== undefined && variables.epicId !== null) {
        qc.invalidateQueries({ queryKey: queryKeys.epic(variables.epicId) });
      }
    },
  });
}

export function useDuplicateTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) =>
      apiRequest<Task>(`/tasks/${taskId}/duplicate`, { method: "POST" }),
    // Returning the Promise.all here (rather than firing invalidations without
    // awaiting) makes React Query await the refetches before resolving
    // mutateAsync — TaskPanel's handleDuplicate awaits the copy and then
    // re-targets the panel at it, so the refetched list is already in cache
    // by the time that happens, avoiding a "Loading task…" flash.
    onSuccess: (data) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        qc.invalidateQueries({ queryKey: ["tasks"] }),
        qc.invalidateQueries({ queryKey: queryKeys.overview }),
        invalidateProjectHealth(qc, projectId),
        invalidateProjectActivity(qc, projectId),
        // Same rationale as useUpdateTask/useDeleteTask above — a duplicated
        // task can newly appear in the Daily Review page's attention lists.
        qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot }),
        // lib/duplicate.ts copies keep `epicId` (§4) — the duplicate can
        // count toward the same epic's total.
        qc.invalidateQueries({ queryKey: queryKeys.projectEpics(projectId) }),
        ...(data.epicId !== null
          ? [qc.invalidateQueries({ queryKey: queryKeys.epic(data.epicId) })]
          : []),
      ]),
  });
}

export interface CreateLabelInput {
  name: string;
  color?: string;
}

export function useCreateLabel(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLabelInput) =>
      apiRequest<Label>(`/projects/${projectId}/labels`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectLabels(projectId) });
    },
  });
}

export function useDeleteLabel(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/labels/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectLabels(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}

export function useComments(taskId: number | null) {
  return useQuery({
    queryKey: taskId ? queryKeys.comments(taskId) : ["tasks", "noop", "comments"],
    queryFn: ({ signal }) =>
      apiRequest<Comment[]>(`/tasks/${taskId}/comments`, { signal }),
    enabled: taskId !== null,
  });
}

export function useProjectSections(id: number | null) {
  const live = useLiveRefresh();
  return useQuery({
    ...live,
    queryKey: id ? queryKeys.projectSections(id) : ["projects", "noop", "sections"],
    queryFn: ({ signal }) =>
      apiRequest<Section[]>(`/projects/${id}/sections`, { signal }),
    enabled: id !== null,
    staleTime: 30_000,
  });
}

export interface CreateSectionInput {
  name: string;
  position?: number;
  color?: string;
}

export function useCreateSection(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSectionInput) =>
      apiRequest<Section>(`/projects/${projectId}/sections`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectSections(projectId) });
    },
  });
}

export function useUpdateSection(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    // Serializes concurrent section PATCHes for this project (e.g. two fast
    // drops in SectionReorderModal): without a shared scope, two mutations
    // can race and their PATCHes can land out of order server-side, and the
    // reorder modal never re-seeds its local order mid-session to mask it
    // (see SectionReorderModal.tsx) — so the wrong drop could "win".
    scope: { id: `sections-${projectId}` },
    mutationFn: ({ id, patch }: { id: number; patch: Partial<CreateSectionInput> }) =>
      apiRequest<Section>(`/sections/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.projectSections(projectId) });
      const prev = qc.getQueryData<Section[]>(queryKeys.projectSections(projectId));
      if (prev) {
        let next: Section[];
        if (patch.position !== undefined) {
          // A plain field-merge (the `else` branch) can't express a
          // reorder: it would leave the moved section sharing its new
          // position with whichever sibling already sat there, and every
          // other sibling stale, until the onSettled refetch below lands —
          // visible as a wrong section-group order in the List view behind
          // an open reorder modal. Re-pack locally instead, mirroring the
          // backend's dense 0..n-1 transaction (routes/sections.ts): pull
          // the moved section out, clamp the requested index into the
          // remaining sibling list, splice it back in, then rewrite every
          // section's position from its new array index.
          const moved = prev.find((s) => s.id === id);
          if (moved) {
            const siblings = prev
              .filter((s) => s.id !== id)
              .sort((a, b) => a.position - b.position || a.id - b.id);
            const clamped = Math.max(0, Math.min(patch.position, siblings.length));
            siblings.splice(clamped, 0, { ...moved, ...patch } as Section);
            next = siblings.map((s, i) => ({ ...s, position: i }));
          } else {
            next = prev;
          }
        } else {
          next = prev.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s));
        }
        qc.setQueryData<Section[]>(queryKeys.projectSections(projectId), next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev)
        qc.setQueryData(queryKeys.projectSections(projectId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectSections(projectId) });
      // Tasks carry `section: { color }`; invalidate so the diagram repaints.
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}

export function useDeleteSection(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/sections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectSections(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}

export function useDuplicateSection(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: number) =>
      apiRequest<{ section: Section; taskCount: number }>(`/sections/${sectionId}/duplicate`, {
        method: "POST",
      }),
    // Same shape as useDuplicateTask above — Promise.all so the invalidated
    // queries have refetched before mutateAsync resolves, plus
    // projectSections (the new group header) alongside the task-shaped
    // invalidations every task-tree write already does.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.projectSections(projectId) }),
        qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        qc.invalidateQueries({ queryKey: ["tasks"] }),
        qc.invalidateQueries({ queryKey: queryKeys.overview }),
        invalidateProjectHealth(qc, projectId),
        qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot }),
        invalidateProjectActivity(qc, projectId),
        // The section's duplicated tasks keep their `epicId` (§4) — their
        // epics' done/total counts can change. Which epics is unknown here
        // (the response is just `{ section, taskCount }`), so bust every
        // open epic-detail cache alongside the list.
        qc.invalidateQueries({ queryKey: queryKeys.projectEpics(projectId) }),
        qc.invalidateQueries({ queryKey: ["epics"] }),
      ]),
  });
}

// Epics (Jira Epic & Story parity, docs/archive/plans/epics-spec.md §5/§7 T2).
// Mirrors the section hooks above in shape, error handling and invalidation
// style.
export function useProjectEpics(projectId: number | null) {
  const live = useLiveRefresh();
  return useQuery({
    ...live,
    queryKey: projectId ? queryKeys.projectEpics(projectId) : ["projects", "noop", "epics"],
    queryFn: ({ signal }) =>
      apiRequest<Epic[]>(`/projects/${projectId}/epics`, { signal }),
    enabled: projectId !== null,
    staleTime: 30_000,
  });
}

export function useEpic(id: number | null) {
  return useQuery({
    queryKey: id ? queryKeys.epic(id) : ["epics", "noop"],
    queryFn: ({ signal }) => apiRequest<EpicDetail>(`/epics/${id}`, { signal }),
    enabled: id !== null,
  });
}

export interface CreateEpicInput {
  title: string;
  description?: string;
  color?: string;
  ownerId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
}

export function useCreateEpic(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEpicInput) =>
      apiRequest<Epic>(`/projects/${projectId}/epics`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectEpics(projectId) });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export interface UpdateEpicInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  color?: string;
  ownerId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  position?: number;
}

export function useUpdateEpic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & UpdateEpicInput) =>
      apiRequest<Epic>(`/epics/${id}`, { method: "PATCH", body: patch }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.projectEpics(data.projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.epic(data.id) });
      invalidateProjectActivity(qc, data.projectId);
    },
  });
}

export function useDeleteEpic() {
  const qc = useQueryClient();
  return useMutation({
    // `projectId` rides along in the mutation variables (rather than as a
    // hook argument, unlike useDeleteSection) since DELETE returns 204 with
    // no body to read it back from, and callers of this hook (the Epics tab
    // row action) already have the epic's `projectId` in hand.
    mutationFn: ({ id }: { id: number; projectId: number }) =>
      apiRequest<void>(`/epics/${id}`, { method: "DELETE" }),
    onSuccess: (_data, { id, projectId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.projectEpics(projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.epic(id) });
      // Deleting an epic keeps its tasks (SetNull, §4) — refresh task lists
      // so the epic chip clears everywhere it was rendered.
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export function useProjectRisks(id: number | null) {
  return useQuery({
    queryKey: id ? queryKeys.projectRisks(id) : ["projects", "noop", "risks"],
    queryFn: ({ signal }) =>
      apiRequest<Risk[]>(`/projects/${id}/risks`, { signal }),
    enabled: id !== null,
  });
}

export interface CreateRiskInput {
  description: string;
  category?: RiskCategory;
  probability?: number;
  impact?: number;
  status?: RiskStatus;
  mitigationPlan?: string | null;
  contingencyPlan?: string | null;
}

export type UpdateRiskInput = Partial<CreateRiskInput>;

export function useCreateRisk(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRiskInput) =>
      apiRequest<Risk>(`/projects/${projectId}/risks`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectRisks(projectId) });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export function useUpdateRisk(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateRiskInput }) =>
      apiRequest<Risk>(`/risks/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.projectRisks(projectId) });
      const prev = qc.getQueryData<Risk[]>(queryKeys.projectRisks(projectId));
      if (prev) {
        qc.setQueryData<Risk[]>(
          queryKeys.projectRisks(projectId),
          prev.map((r) => (r.id === id ? ({ ...r, ...patch } as Risk) : r)),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev)
        qc.setQueryData(queryKeys.projectRisks(projectId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectRisks(projectId) });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
      // Same rationale as useUpdateTask above — open risks are
      // inline-editable from the Daily Review page's attention lists too.
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
    },
  });
}

export function useDeleteRisk(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/risks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectRisks(projectId) });
      invalidateProjectHealth(qc, projectId);
      invalidateProjectActivity(qc, projectId);
      // Same rationale as useUpdateRisk above — a deleted risk can drop out
      // of the Daily Review page's open-risks attention list.
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Daily Review v2 — the page's one-request payload, plus every mutation it
// drives (daily-review-v2-spec.md §6.1). Every "inline edit" mutation below
// (note add/edit/delete, mark/unmark reviewed, customer-note add/edit/
// delete) follows the house optimistic pattern (frontend/CLAUDE.md):
// `onMutate` cancels in-flight `["daily-review"]` queries, snapshots every
// cached one, and writes the optimistic change into each via
// `setQueriesData` (a project can appear in exactly one of
// `customers[].projects`/`unassignedProjects`, and the caller may have
// several week-keyed `["daily-review", week, today]` entries cached at
// once — Prev/Next navigation, `placeholderData` — so every one of them
// needs the same write, not just "the current" query). `onError` restores
// the snapshot; `onSettled` invalidates so the server's authoritative
// response lands. Weekly-update save is the one plain (non-optimistic)
// mutation in this group — see its own comment below.
// ─────────────────────────────────────────────────────────────────────────

// Monotonically decreasing temporary ids for optimistically-added notes,
// swapped out for the server's real (positive, autoincrement) id once
// onSettled's invalidation refetches. Negative so a temp id can never
// collide with a real one.
let nextTempNoteId = -1;
function tempNoteId(): number {
  return nextTempNoteId--;
}

/** Maps `updater` over the ONE project with `projectId`, wherever it lives
 * (`customers[].projects` or `unassignedProjects` — a project is in
 * exactly one). Every other project/customer is returned unchanged. */
function updateDailyReviewProject(
  data: DailyReviewResponse,
  projectId: number,
  updater: (p: DailyReviewProject) => DailyReviewProject,
): DailyReviewResponse {
  return {
    ...data,
    customers: data.customers.map((c) => ({
      ...c,
      projects: c.projects.map((p) => (p.id === projectId ? updater(p) : p)),
    })),
    unassignedProjects: data.unassignedProjects.map((p) =>
      p.id === projectId ? updater(p) : p,
    ),
  };
}

/** Maps `updater` over the one customer with `customerId`. */
function updateDailyReviewCustomer(
  data: DailyReviewResponse,
  customerId: number,
  updater: (c: DailyReviewCustomer) => DailyReviewCustomer,
): DailyReviewResponse {
  return {
    ...data,
    customers: data.customers.map((c) => (c.id === customerId ? updater(c) : c)),
  };
}

/**
 * (noteDate, id) comparator matching the server's own note ordering
 * (`orderBy: [{ noteDate: "asc" }, { id: "asc" }]`), extended for
 * optimistically-added notes: `tempNoteId()` hands out DECREASING negative
 * ids (-1, -2, -3, ...) in call order, so a plain ascending `id` compare
 * would sort a brand-new temp note BEFORE an older one — and before every
 * real, positive-id note — on the same day, which is backwards both ways.
 * Real (positive) ids always sort before temp (negative) ones; within each
 * group, ascending `noteDate` then the group's own chronological order:
 * ascending id for reals, DESCENDING id for temps, since a later
 * `tempNoteId()` call returns a smaller (more negative) number.
 */
function compareNotesByDayThenId(
  a: { noteDate: string; id: number },
  b: { noteDate: string; id: number },
): number {
  const dayCompare = a.noteDate.localeCompare(b.noteDate);
  if (dayCompare !== 0) return dayCompare;
  const aTemp = a.id < 0;
  const bTemp = b.id < 0;
  if (aTemp !== bTemp) return aTemp ? 1 : -1;
  return aTemp ? b.id - a.id : a.id - b.id;
}

/**
 * Finds the calendar day (`dayFromIso`) of an already-cached project note
 * by scanning every `["daily-review"]` snapshot — used by the update/
 * delete note mutations below, whose own mutation input carries only
 * `noteId` (not a day), to skip the optimistic write on a cached week that
 * can't possibly contain this note. Undefined when the note isn't found in
 * any snapshot, in which case the caller skips the guard rather than
 * risk dropping a legitimate edit.
 */
function findProjectNoteDay(
  snapshots: [unknown, DailyReviewResponse | undefined][],
  projectId: number,
  noteId: number,
): string | undefined {
  for (const [, data] of snapshots) {
    if (!data) continue;
    const projects = [...data.customers.flatMap((c) => c.projects), ...data.unassignedProjects];
    const note = projects.find((p) => p.id === projectId)?.notes.find((n) => n.id === noteId);
    if (note) return dayFromIso(note.noteDate) ?? undefined;
  }
  return undefined;
}

/** Same as `findProjectNoteDay`, for a customer's operations notes. */
function findCustomerNoteDay(
  snapshots: [unknown, DailyReviewResponse | undefined][],
  customerId: number,
  noteId: number,
): string | undefined {
  for (const [, data] of snapshots) {
    if (!data) continue;
    const note = data.customers
      .find((c) => c.id === customerId)
      ?.operationsNotes.find((n) => n.id === noteId);
    if (note) return dayFromIso(note.noteDate) ?? undefined;
  }
  return undefined;
}

export function useDailyReview(week: string) {
  // `today` is the browser's local calendar day — same day-boundary
  // rationale as useOverview/useExecutiveReport above: it's part of the
  // query key (not just the URL) so a render after local midnight
  // naturally gets a fresh key instead of serving yesterday's cached
  // payload. `placeholderData` keeps the previous week's page showing while
  // Prev/Next week's request is in flight, instead of flashing a skeleton.
  const today = dateToDay(new Date())!;
  return useQuery({
    queryKey: queryKeys.dailyReview(week, today),
    queryFn: ({ signal }) =>
      apiRequest<DailyReviewResponse>(
        `/daily-review?week=${encodeURIComponent(week)}&today=${encodeURIComponent(today)}`,
        { signal },
      ),
    enabled: parseWeekKey(week) !== null,
    placeholderData: (prev) => prev,
  });
}

export function useProjectNotes(
  id: number | null,
  opts: { visibility?: NoteVisibility; limit?: number; from?: string; to?: string } = {},
) {
  const { visibility, limit, from, to } = opts;
  return useQuery({
    queryKey: id
      ? queryKeys.projectNotes(id, { visibility, limit, from, to })
      : ["projects", "noop", "notes"],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (visibility) params.set("visibility", visibility);
      if (limit) params.set("limit", String(limit));
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      return apiRequest<ProjectNote[]>(
        `/projects/${id}/notes${qs ? `?${qs}` : ""}`,
        { signal },
      );
    },
    enabled: id !== null,
  });
}

// The Internal/Customer-facing toggle is gone from the UI (Decision 1,
// daily-review-v2-spec.md §3) — every note the UI writes gets the API's
// INTERNAL default, so `visibility` is deliberately absent here and never
// sent by this mutation. `noteDate` is a plain "yyyy-MM-dd" day string (the
// DateField/day-strip contract) — the API stores and returns every
// `@db.Date` field (`noteDate`, `reviewDate`, ...) as an ISO instant
// (`T00:00:00.000Z`), so every optimistic write below converts at the
// boundary via `isoFromDay`/`dayFromIso`, never comparing a bare day string
// to an ISO instant directly.
export interface CreateNoteInput {
  body: string;
  noteDate: string;
}

export function useAddProjectNote(projectId: number) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: CreateNoteInput) =>
      apiRequest<ProjectNote>(`/projects/${projectId}/notes`, {
        method: "POST",
        body: input,
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      const optimisticNote: DailyReviewNote = {
        id: tempNoteId(),
        noteDate: isoFromDay(input.noteDate)!,
        body: input.body,
        author: user ? { id: user.id, username: user.username } : { id: 0, username: "" },
        updatedAt: new Date().toISOString(),
      };
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        // Skip a cached week that can't contain this day — every cached
        // `["daily-review", week, today]` entry gets the same updater
        // (Prev/Next navigation + placeholderData can keep several around
        // at once), and without this a note dated in the open week would
        // also get written into an unrelated cached week's project.
        if (!old.week.days.includes(input.noteDate)) return old;
        return updateDailyReviewProject(old, projectId, (p) => ({
          ...p,
          notes: [...p.notes, optimisticNote].sort(compareNotesByDayThenId),
        }));
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      // Every visibility/window-bucketed key for this project (see
      // queryKeys.projectNotes's doc) — not just the "all, unwindowed" one.
      qc.invalidateQueries({ queryKey: ["projects", projectId, "notes"] });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export interface UpdateProjectNoteInput {
  noteId: number;
  body: string;
}

export function useUpdateProjectNote(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: UpdateProjectNoteInput) =>
      apiRequest<ProjectNote>(`/projects/${projectId}/notes/${noteId}`, {
        method: "PATCH",
        body: { body },
      }),
    onMutate: async ({ noteId, body }) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      const day = findProjectNoteDay(previous, projectId, noteId);
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        if (day !== undefined && !old.week.days.includes(day)) return old;
        return updateDailyReviewProject(old, projectId, (p) => ({
          ...p,
          notes: p.notes.map((n) =>
            n.id === noteId ? { ...n, body, updatedAt: new Date().toISOString() } : n,
          ),
        }));
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      qc.invalidateQueries({ queryKey: ["projects", projectId, "notes"] });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export function useDeleteProjectNote(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId }: { noteId: number }) =>
      apiRequest<void>(`/projects/${projectId}/notes/${noteId}`, { method: "DELETE" }),
    onMutate: async ({ noteId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      const day = findProjectNoteDay(previous, projectId, noteId);
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        if (day !== undefined && !old.week.days.includes(day)) return old;
        return updateDailyReviewProject(old, projectId, (p) => ({
          ...p,
          notes: p.notes.filter((n) => n.id !== noteId),
        }));
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      qc.invalidateQueries({ queryKey: ["projects", projectId, "notes"] });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

export function useMarkProjectReviewed(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewDate }: { reviewDate: string }) =>
      apiRequest<ProjectReviewRecord>(`/projects/${projectId}/reviews`, {
        method: "POST",
        body: { reviewDate },
      }),
    onMutate: async ({ reviewDate }) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      const reviewDateIso = isoFromDay(reviewDate)!;
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        if (!old.week.days.includes(reviewDate)) return old;
        return updateDailyReviewProject(old, projectId, (p) => {
          // Mirrors the server's upsert semantics (POST is idempotent).
          if (p.reviews.some((r) => dayFromIso(r.reviewDate) === reviewDate)) return p;
          return {
            ...p,
            reviews: [
              ...p.reviews,
              { reviewDate: reviewDateIso, createdAt: new Date().toISOString() },
            ],
          };
        });
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.navBadgesRoot });
    },
  });
}

export function useUnmarkProjectReviewed(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewDate }: { reviewDate: string }) =>
      apiRequest<void>(`/projects/${projectId}/reviews/${reviewDate}`, { method: "DELETE" }),
    onMutate: async ({ reviewDate }) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        if (!old.week.days.includes(reviewDate)) return old;
        return updateDailyReviewProject(old, projectId, (p) => ({
          ...p,
          reviews: p.reviews.filter((r) => dayFromIso(r.reviewDate) !== reviewDate),
        }));
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.navBadgesRoot });
    },
  });
}

// ---- Customer (operations) notes -------------------------------------------
// Same author-only edit / wildcard-delete rule as ProjectNote (Decision 9).
// Optimistic for consistency with project notes above — same updater shape,
// applied to `operationsNotes` via updateDailyReviewCustomer instead of
// updateDailyReviewProject.

export interface CreateCustomerNoteInput {
  body: string;
  noteDate: string;
  title: string;
}

export function useAddCustomerNote(customerId: number) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: CreateCustomerNoteInput) =>
      apiRequest<DailyReviewOpsNote>(`/customers/${customerId}/notes`, {
        method: "POST",
        body: input,
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      const optimisticNote: DailyReviewOpsNote = {
        id: tempNoteId(),
        noteDate: isoFromDay(input.noteDate)!,
        body: input.body,
        author: user ? { id: user.id, username: user.username } : { id: 0, username: "" },
        updatedAt: new Date().toISOString(),
        title: input.title,
      };
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        if (!old.week.days.includes(input.noteDate)) return old;
        return updateDailyReviewCustomer(old, customerId, (c) => ({
          ...c,
          operationsNotes: [...c.operationsNotes, optimisticNote].sort(compareNotesByDayThenId),
        }));
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      qc.invalidateQueries({ queryKey: queryKeys.customerNotesRoot(customerId) });
    },
  });
}

export interface UpdateCustomerNoteInput {
  noteId: number;
  body?: string;
  title?: string;
}

export function useUpdateCustomerNote(customerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, ...patch }: UpdateCustomerNoteInput) =>
      apiRequest<DailyReviewOpsNote>(`/customers/${customerId}/notes/${noteId}`, {
        method: "PATCH",
        body: patch,
      }),
    onMutate: async ({ noteId, body, title }) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      const day = findCustomerNoteDay(previous, customerId, noteId);
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        if (day !== undefined && !old.week.days.includes(day)) return old;
        return updateDailyReviewCustomer(old, customerId, (c) => ({
          ...c,
          operationsNotes: c.operationsNotes.map((n) => {
            if (n.id !== noteId) return n;
            return {
              ...n,
              ...(body !== undefined && { body }),
              ...(title !== undefined && { title }),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      qc.invalidateQueries({ queryKey: queryKeys.customerNotesRoot(customerId) });
    },
  });
}

export function useDeleteCustomerNote(customerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId }: { noteId: number }) =>
      apiRequest<void>(`/customers/${customerId}/notes/${noteId}`, { method: "DELETE" }),
    onMutate: async ({ noteId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.dailyReviewRoot });
      const previous = qc.getQueriesData<DailyReviewResponse>({
        queryKey: queryKeys.dailyReviewRoot,
      });
      const day = findCustomerNoteDay(previous, customerId, noteId);
      qc.setQueriesData<DailyReviewResponse>({ queryKey: queryKeys.dailyReviewRoot }, (old) => {
        if (!old) return old;
        if (day !== undefined && !old.week.days.includes(day)) return old;
        return updateDailyReviewCustomer(old, customerId, (c) => ({
          ...c,
          operationsNotes: c.operationsNotes.filter((n) => n.id !== noteId),
        }));
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      qc.invalidateQueries({ queryKey: queryKeys.customerNotesRoot(customerId) });
    },
  });
}

// ---- Weekly updates (per customer, Decision 2) -----------------------------

// Every key but `weekStart` is optional (docs/archive/plans/weekly-sync-tables.md
// §3 D12, the backend's partial-save contract): an OMITTED key leaves the
// stored value unchanged, while `null` (or a whitespace-only string, for
// the text fields) clears it. This is what lets the Mid-week and Reflection
// modals each save their own half of the row without clobbering the
// other's unsaved work — a modal must only include the keys it actually
// edits, never spread in the fields it doesn't own. `highlights` is the
// list the Mid-week form owns (docs/archive/plans/weekly-sync-highlight-rows.md
// D6): present replaces the week's highlights in list order (an empty array
// clears them), omitted leaves the stored list untouched — the Reflection
// modal never sends this key. `achievements` is the mirror list the
// Reflection form owns (docs/archive/plans/weekly-sync-achievement-rows.md D6):
// present replaces the week's achievements in list order (an empty array
// clears them), omitted leaves the stored list untouched — the Mid-week
// modal never sends this key. `src/lib/api.ts`'s `JSON.stringify(body)`
// drops any key whose value is `undefined`, so an explicitly-`undefined`
// field and one never set on the object reach the server identically
// (absent) and leave the stored value unchanged either way; only `null` or
// a whitespace-only string actually clears a text field (`normalizeText` in
// `backend/src/routes/customers.ts`). `status` is never sent by the
// Mid-week modal — the backend defaults it to DRAFT on create and otherwise
// leaves it alone.
export interface SaveWeeklyUpdateInput {
  weekStart: string;
  // The `updatedAt` of the row the form was opened from, or null when there
  // was none yet. The server refuses with 409 stale_write when the row moved.
  expectedUpdatedAt?: string | null;
  health?: WeeklyHealth | null;
  status?: WeeklyStatus;
  category?: string | null;
  highlights?: WeeklyHighlightInput[];
  achievements?: WeeklyAchievementInput[];
}

// Plain mutation, no onMutate optimism (spec §6.1): the textarea already
// holds its own draft state until Save, so there's nothing new to render
// optimistically that isn't already on screen — unlike the inline-edit
// mutations above. Saving an already-DONE update keeps its original
// `doneAt` server-side; nothing to special-case here.
export function useSaveWeeklyUpdate(customerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ weekStart, ...body }: SaveWeeklyUpdateInput) =>
      apiRequest<WeeklyUpdate>(`/customers/${customerId}/weekly-updates/${weekStart}`, {
        method: "PUT",
        body,
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      // The bare PREFIX (not queryKeys.customerWeeklyUpdates(customerId),
      // which now bakes a specific `limit` into the key) — so a save
      // refreshes every limit-bucketed cache entry for this customer, not
      // just the unlimited one.
      qc.invalidateQueries({ queryKey: ["customers", customerId, "weekly-updates"] });
      // GET /customers carries each customer's `health.weeklyUpdate`, so the
      // list (key ["customers", today], two segments) and this customer's
      // detail go stale on a save too.
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "customers" && q.queryKey.length === 2,
      });
      qc.invalidateQueries({ queryKey: queryKeys.customer(customerId) });
    },
  });
}

export function useCustomerWeeklyUpdates(customerId: number | null, limit?: number) {
  return useQuery({
    queryKey: customerId
      ? queryKeys.customerWeeklyUpdates(customerId, limit)
      : ["customers", "noop", "weekly-updates"],
    queryFn: ({ signal }) => {
      const qs = limit ? `?limit=${limit}` : "";
      return apiRequest<WeeklyUpdate[]>(
        `/customers/${customerId}/weekly-updates${qs}`,
        { signal },
      );
    },
    enabled: customerId !== null,
  });
}

// GET /customers/:id/notes (newest first, `limit` 1-100) — the same rows the
// Daily Review lists as operations notes.
export function useCustomerNotes(customerId: number | null, limit: number) {
  return useQuery({
    queryKey: customerId
      ? queryKeys.customerNotes(customerId, limit)
      : ["customers", "noop", "notes"],
    queryFn: ({ signal }) =>
      apiRequest<DailyReviewOpsNote[]>(`/customers/${customerId}/notes?limit=${limit}`, {
        signal,
      }),
    enabled: customerId !== null,
  });
}

export function useAddComment(taskId: number, projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, mentionedUserIds }: { body: string; mentionedUserIds?: number[] }) =>
      apiRequest<Comment>(`/tasks/${taskId}/comments`, {
        method: "POST",
        body: mentionedUserIds && mentionedUserIds.length > 0 ? { body, mentionedUserIds } : { body },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.comments(taskId) });
      invalidateProjectActivity(qc, projectId);
    },
  });
}

// ---- iTop tickets (Task 1.8) ------------------------------------------
// Non-admin iTop reads: connection status (gates the Customer Tickets tab
// and builds "Open in iTop ↗" links) and a customer's ticket list + counts.
// Backend: routes/itop.ts, mounted at /itop — any authed user with
// visibility into the customer can read (no admin gate), unlike the
// adminQueryKeys `itop*` hooks further down this file, which back the Admin
// "iTop" tab (routes/itopAdmin.ts). See
// docs/archive/plans/itop-integration.md Task 1.8.

export type ItopTicketScope = "ongoing" | "resolved_week" | "mine";
export type ItopTicketClass = "UserRequest" | "Incident";

export interface ItopStatus {
  configured: boolean;
  baseUrl: string | null;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  // `lastSyncError` is deliberately NOT part of this response — the raw
  // iTop error text is admin-only (see the Admin "iTop" tab / GET
  // /admin/itop/settings for that). Non-admin callers only learn
  // "did the last sync fail", not why.
  refreshMinutes: number;
  // Whether Admin has switched on the write path at all (Task 5.2) — gates
  // whether TicketPanel.tsx shows any action affordance regardless of
  // whether *this* viewer has a personal token (see `MyItopTokenStatus.set`
  // for that half of the gate).
  actionsEnabled: boolean;
}

export interface ItopTicketRow {
  id: number;
  class: ItopTicketClass;
  ref: string;
  title: string;
  status: string;
  operationalStatus: string | null;
  priority: string | null;
  agentPersonId: number | null;
  agentName: string | null;
  teamName: string | null;
  serviceName: string | null;
  callerName: string | null;
  startDate: string | null;
  lastUpdate: string;
  tto: string | null;
  ttr: string | null;
  slaTtoPassed: boolean;
  slaTtrPassed: boolean;
  resolutionDate: string | null;
  isMine: boolean;
}

export interface ItopTicketCounts {
  ongoing: number;
  resolvedWeek: number;
  mine: number;
  incidents: number;
  requests: number;
}

// Discriminated on `mapped` — GET /itop/customers/:id/tickets answers
// `mapped: false` (no org linked; empty tickets/counts) or `mapped: true`
// (org name + the scoped ticket list), rather than a nullable orgName.
export type CustomerTicketsResponse =
  | { mapped: false; tickets: []; counts: ItopTicketCounts; syncedAt: null }
  | {
      mapped: true;
      orgName: string | null;
      tickets: ItopTicketRow[];
      counts: ItopTicketCounts;
      syncedAt: string | null;
    };

export function useItopStatus() {
  return useQuery({
    queryKey: queryKeys.itopStatus,
    queryFn: ({ signal }) => apiRequest<ItopStatus>("/itop/status", { signal }),
    staleTime: 60_000,
  });
}

// ---- Personal iTop token (Task 5.2) ------------------------------------
// Settings.tsx's "iTop" section: each TAM pastes their own personal token
// (scope REST/JSON) so ticket actions (Task 5.3/5.4) are written under their
// own name. Backend: PUT/GET/DELETE /itop/me/token, routes/itop.ts.
// `configured` mirrors `ItopStatus.configured` (the app-wide connection) —
// Settings.tsx gates the whole section on it, per the dispatch contract,
// rather than a second `useItopStatus()` call.
export interface MyItopTokenStatus {
  set: boolean;
  personName: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  actionsEnabled: boolean;
  configured: boolean;
  // Present and true only when a token is stored but can no longer be
  // decrypted (e.g. a `SECRETS_KEY` rotation) — Settings.tsx shows a
  // "enter it again" prompt instead of a stale "Valid" status line.
  unreadable?: boolean;
}

export function useMyItopToken() {
  return useQuery({
    queryKey: queryKeys.myItopToken,
    queryFn: ({ signal }) => apiRequest<MyItopTokenStatus>("/itop/me/token", { signal }),
    staleTime: 60_000,
  });
}

export function useSaveMyItopToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string }) =>
      apiRequest<MyItopTokenStatus>("/itop/me/token", { method: "PUT", body: input }),
    onSuccess: (fresh) => {
      qc.setQueryData(queryKeys.myItopToken, fresh);
      qc.invalidateQueries({ queryKey: queryKeys.itopStatus });
    },
  });
}

export function useRemoveMyItopToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>("/itop/me/token", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myItopToken });
      qc.invalidateQueries({ queryKey: queryKeys.itopStatus });
    },
  });
}

export function useCustomerTickets(
  customerId: number,
  {
    scope,
    cls,
    enabled = true,
    poll = false,
  }: { scope: ItopTicketScope; cls?: ItopTicketClass; enabled?: boolean; poll?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.customerTickets(customerId, scope, cls),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ scope });
      if (cls) params.set("class", cls);
      return apiRequest<CustomerTicketsResponse>(
        `/itop/customers/${customerId}/tickets?${params.toString()}`,
        { signal },
      );
    },
    enabled,
    staleTime: 30_000,
    // The first `refetchInterval` in the app (frontend/CLAUDE.md's Task 1.8
    // dispatch note flags this) — keep it scoped to this hook only. Backs
    // the Tickets tab's "refreshed every 5 minutes" promise
    // (docs/archive/plans/itop-integration-spec.md's mockup) while resting on
    // top of the backend's own sync cadence; `refetchIntervalInBackground:
    // false` so a backgrounded tab stops polling. `poll` defaults false so
    // CustomerDetail.tsx's own tab-visibility gate call (every customer page
    // load) doesn't quietly turn into a background poll for every visitor —
    // only TicketsTab.tsx's own call (the tab actually open) passes `true`.
    refetchInterval: poll ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
}

// Task 7.2, docs/archive/plans/itop-integration.md: gates `TaskTicketField`'s
// "Create in iTop" affordance on the task's project's customer being mapped
// to an org, WITHOUT a new backend endpoint — reuses the exact `mapped` flag
// CustomerDetail.tsx already derives from `useCustomerTickets` for its own
// Tickets-tab gate (see that file's `ticketsAvailable`). `poll: false` since
// this is a one-shot gate check, not a live list.
export function useItopCustomerMapped(
  customerId: number | null,
  { enabled = true }: { enabled?: boolean } = {},
): boolean {
  const query = useCustomerTickets(customerId ?? -1, {
    scope: "ongoing",
    enabled: enabled && customerId !== null,
    poll: false,
  });
  return query.data?.mapped === true;
}

export function useRequestItopRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { customerId?: number } = {}) =>
      apiRequest<{ requested: boolean; reason?: string; lastSyncAt: string | null }>(
        "/itop/refresh",
        { method: "POST", body: input },
      ),
    onSuccess: (_data, variables) => {
      // POST /refresh only requests a sync — the sync itself runs async
      // server-side (routes/itop.ts), so invalidating immediately would
      // very likely refetch the pre-sync snapshot. 3s is a guess at "long
      // enough"; useCustomerTickets' own 60s refetchInterval (when polling)
      // is the belt-and-braces fallback if this fires too early or the sync
      // takes longer.
      const key = variables?.customerId !== undefined
        ? queryKeys.customerTicketsRoot(variables.customerId)
        : (["itop"] as const);
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: key });
        qc.invalidateQueries({ queryKey: queryKeys.itopStatus });
        // Unconditional (not folded into `key` above): a customer-scoped
        // refresh's `key` is a sibling branch (["itop","customers",id,
        // "tickets"]) that would never match a by-ref cache entry, and a
        // task's pinned ticket can belong to any customer regardless of
        // which one triggered this refresh.
        qc.invalidateQueries({ queryKey: queryKeys.itopTicketByRefRoot });
      }, 3000);
    },
  });
}

// Task ticket ref (Task 4.2, docs/archive/plans/itop-integration.md):
// TaskTicketField.tsx looks up a task's pinned `itopTicketRef` against the
// snapshot for its status chip + "Open in iTop" link. `retry: false` — a 404
// (`not_found`, covering unknown/hidden/unmapped alike per
// routes/itop.ts) is an expected steady state (the ref hasn't synced yet, or
// never will), not a transient failure worth retrying.
export function useItopTicketByRef(ref: string | null) {
  return useQuery({
    queryKey: queryKeys.itopTicketByRef(ref ?? ""),
    queryFn: ({ signal }) =>
      apiRequest<ItopTicketRow>(`/itop/tickets/by-ref/${encodeURIComponent(ref ?? "")}`, {
        signal,
      }),
    enabled: !!ref,
    retry: false,
    staleTime: 60_000,
  });
}

// ---- Ticket panel: detail, actions, log (Task 5.4) ---------------------
// Backend: GET /itop/tickets/:id (row + publicLog/privateLog), POST
// /itop/tickets/:id/actions (lifecycle stimuli), POST /itop/tickets/:id/log
// (append a log entry) — all routes/itop.ts. No optimistic writes anywhere
// here (plan decision — "no queued or optimistic writes"): both mutations
// below have no `onMutate`; the panel only ever shows what iTop's own
// `core/get` answer (returned by the action/log endpoint) says.
export interface ItopTicketLogEntry {
  date: string | null;
  author: string | null;
  message: string;
}

export interface ItopTicketDetail extends ItopTicketRow {
  publicLog: ItopTicketLogEntry[];
  privateLog: ItopTicketLogEntry[];
  // Task 7.1, docs/archive/plans/itop-integration.md: the caller's own
  // logged minutes on THIS ticket, for the caller's local ISO week (backend
  // buckets by `utcOffsetMinutes`, same contract as `/itop/daily` and
  // `/utilization`). `TicketTimer.tsx` divides by 60 for the "N.N h this
  // week" copy. Optional (fix round, phase review): only `GET
  // /itop/tickets/:id` computes this — the action/log/create write
  // endpoints' `core/get` echo doesn't, so `useTicketActionFor`/
  // `useAddTicketLog`'s `setQueryData` below must merge in the PREVIOUS
  // cached value rather than overwrite it with `undefined`.
  myMinutesThisWeek?: number;
}

// Response shape for the two write endpoints only (GET /itop/tickets/:id
// never sets this). iTop can accept a write and then have the immediate
// follow-up `core/get` fail (a blip, a slow instance) — `staleAfterWrite:
// true` means the write went through but the ticket fields on THIS response
// are the PRE-write snapshot, not what iTop just applied. Callers must not
// cache this row as current.
export interface ItopTicketWriteResult extends ItopTicketDetail {
  staleAfterWrite?: boolean;
}

export type ItopTicketActionName = "assign_to_me" | "pending" | "resolve" | "close" | "reopen";

export interface ItopTicketActionInput {
  action: ItopTicketActionName;
  fields?: Record<string, string | number>;
}

// Shape of `ApiError.body.details.teams` on a 409 `itop_team_required`
// refusal (assign_to_me when iTop demands a team alongside the agent) —
// TicketPanel.tsx reads this off the caught error itself, not a query.
export interface ItopTicketTeamOption {
  id: number;
  name: string;
}

export function useItopTicket(id: number | null) {
  // Local minus UTC, in minutes — same computation as `useItopDaily`/
  // `useUtilization` (Task 7.1): the backend buckets `myMinutesThisWeek` by
  // the CALLER's local ISO week. Deliberately NOT folded into the query key
  // below (unlike those two hooks) — `queryKeys.itopTicket(id)` is also the
  // exact key `useTicketActionFor`/`useAddTicketLog`/`useCreateTicket`/
  // `useLogTicketTimeFor` read and write via `setQueryData`/`invalidateQueries`
  // elsewhere in this file; splitting the cache entry by offset would break
  // those cache writes for no real benefit (a viewer's UTC offset changing
  // mid-session is a non-event this field can tolerate being briefly stale
  // for, unlike a whole day/week bucket flipping).
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  return useQuery({
    queryKey: queryKeys.itopTicket(id ?? -1),
    queryFn: ({ signal }) =>
      apiRequest<ItopTicketDetail>(
        `/itop/tickets/${id}?utcOffsetMinutes=${utcOffsetMinutes}`,
        { signal },
      ),
    enabled: id !== null,
    staleTime: 30_000,
  });
}

// ---- Ticket timer (Task 7.1, docs/archive/plans/itop-integration.md) ---
// `useTicketTimer`/`useRunningItopTimer` (components/itop/useTicketTimer.ts)
// own the localStorage-persisted timer state and call this mutation only on
// Stop. Backend: POST /itop/tickets/:id/time, routes/itop.ts — 201 with the
// created entry, or 202 `staleAfterWrite` (iTop accepted the create but the
// follow-up read failed).
//
// Backend contract note (fix round, phase review): the 201 body carries
// `{ entry }` ONLY — no `myMinutesThisWeek` of its own (an earlier revision
// of this endpoint returned a UTC-week-bucketed figure here, which this app
// never trusted anyway since it doesn't match `GET /itop/tickets/:id?
// utcOffsetMinutes=`'s local-week bucketing). `onSuccess` below only
// invalidates, so the panel's "this week" figure always comes from the next
// `useItopTicket` refetch.
export interface ItopTimeLogEntry {
  id: number;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  title: string | null;
  ticketRef: string;
}

export interface ItopTimeLogResult {
  entry: ItopTimeLogEntry;
}

export interface ItopTimeLogStale {
  created: true;
  id: number;
  staleAfterWrite: true;
}

export type ItopTimeLogWriteResult = ItopTimeLogResult | ItopTimeLogStale;

/** True for the 202 shape — no `entry` in this response. */
export function isStaleTimeLog(result: ItopTimeLogWriteResult): result is ItopTimeLogStale {
  return "created" in result && result.created === true;
}

export interface LogTicketTimeInput {
  ticketId: number;
  customerId: number;
  startedAt: string;
  endedAt: string;
  title?: string;
}

// `ticketId`/`customerId` are per-MUTATE-CALL arguments (not fixed at hook
// instantiation), same rationale as `useTicketActionFor` above — kept as a
// separate "For" mutation in case a future caller (e.g. a timer surfaced
// from somewhere other than one fixed ticket panel) needs to act on
// whichever ticket it's currently handling.
export function useLogTicketTimeFor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, startedAt, endedAt, title }: LogTicketTimeInput) =>
      apiRequest<ItopTimeLogWriteResult>(`/itop/tickets/${ticketId}/time`, {
        method: "POST",
        body: { startedAt, endedAt, ...(title ? { title } : {}) },
      }),
    onSuccess: (_result, variables) => {
      // No `setQueryData` here (see the module comment above) — the ticket
      // detail's `myMinutesThisWeek` is local-week bucketed and this
      // response's isn't, so the ONLY correct way to refresh it is a refetch
      // through `useItopTicket`'s own `utcOffsetMinutes` call. The panel's
      // "this week" figure updates as soon as that refetch lands (it's an
      // active query while the panel's open, so `invalidateQueries` fires it
      // immediately) rather than from this mutation's own response.
      qc.invalidateQueries({ queryKey: queryKeys.itopTicket(variables.ticketId) });
      qc.invalidateQueries({ queryKey: queryKeys.utilizationRoot });
      // Defensive, matching the sibling ticket-write mutations' own
      // invalidation of the customer's ticket list — logging time doesn't
      // change a ticket's status, but keeps this mutation's invalidation
      // shape consistent with `useTicketActionFor`/`useAddTicketLog` in case
      // an install's TimeSpent creation ever bumps the ticket's own
      // `last_update`.
      qc.invalidateQueries({ queryKey: queryKeys.customerTicketsRoot(variables.customerId) });
      // A task panel's ticket chip reads the by-ref cache — refresh it too.
      qc.invalidateQueries({ queryKey: queryKeys.itopTicketByRefRoot });
    },
  });
}

// `onSuccess`'s cache write is deliberately conditional: a `staleAfterWrite`
// response must never be cached as the current ticket (its fields are the
// PRE-write snapshot) — invalidate instead so the next fetch (or manual
// Refresh) picks up the real state once iTop's read succeeds. The caller
// (TicketPanel.tsx) reads `staleAfterWrite` off its own per-call `onSuccess`
// (React Query runs the hook's `onSuccess` first, then the mutate-call's) to
// show the "refreshes on next sync" notice.
//
// `ticketId` is a per-MUTATE-CALL argument here, not a per-hook-instantiation
// one (fix round, phase review) — `TicketBoard.tsx` (Task 6.1) can act on
// whichever card a drag or "Assign to me" click targets, and the Rules of
// Hooks forbid calling a differently-parameterized hook per drop event. This
// is the single write path both the board and `useTicketAction` below (a
// thin per-ticket wrapper for callers that always act on one known ticket —
// the panel, the daily strip) route through.
export function useTicketActionFor(customerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      action,
      fields,
    }: {
      ticketId: number;
      action: ItopTicketActionName;
      fields?: Record<string, string | number>;
    }) =>
      apiRequest<ItopTicketWriteResult>(`/itop/tickets/${ticketId}/actions`, {
        method: "POST",
        body: { action, fields },
      }),
    onSuccess: (fresh, variables) => {
      if (fresh.staleAfterWrite) {
        qc.invalidateQueries({ queryKey: queryKeys.itopTicket(variables.ticketId) });
      } else {
        // The action route's `core/get` echo doesn't compute
        // `myMinutesThisWeek` (fix round, phase review) — merging in the
        // previous cache's value (falling back to 0 if there wasn't one)
        // keeps the panel's "this week" figure from flashing to "0.0 h"
        // after every action, until the next full refetch.
        qc.setQueryData(
          queryKeys.itopTicket(variables.ticketId),
          (prev: ItopTicketDetail | undefined) => ({
            ...fresh,
            myMinutesThisWeek: fresh.myMinutesThisWeek ?? prev?.myMinutesThisWeek ?? 0,
          }),
        );
      }
      qc.invalidateQueries({ queryKey: queryKeys.customerTicketsRoot(customerId) });
      // A task panel's ticket chip reads the by-ref cache — refresh it too.
      qc.invalidateQueries({ queryKey: queryKeys.itopTicketByRefRoot });
      qc.invalidateQueries({ queryKey: queryKeys.itopDailyRoot });
    },
  });
}

/** Thin wrapper over `useTicketActionFor` fixing `ticketId` — same call
 * shape as before (`.mutate({ action, fields })`), no call-site churn for
 * `TicketPanel.tsx`/`DailyItopStrip.tsx`. */
export function useTicketAction(ticketId: number, customerId: number) {
  const mutation = useTicketActionFor(customerId);
  function mutate(input: ItopTicketActionInput, options?: Parameters<typeof mutation.mutate>[1]) {
    return mutation.mutate({ ticketId, ...input }, options);
  }
  return { ...mutation, mutate };
}

export function useAddTicketLog(ticketId: number, customerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { visibility: "public" | "private"; text: string }) =>
      apiRequest<ItopTicketWriteResult>(`/itop/tickets/${ticketId}/log`, {
        method: "POST",
        body: input,
      }),
    onSuccess: (fresh) => {
      if (fresh.staleAfterWrite) {
        qc.invalidateQueries({ queryKey: queryKeys.itopTicket(ticketId) });
      } else {
        // Same merge rationale as `useTicketActionFor` above — the log
        // route's echo doesn't carry `myMinutesThisWeek` either.
        qc.setQueryData(
          queryKeys.itopTicket(ticketId),
          (prev: ItopTicketDetail | undefined) => ({
            ...fresh,
            myMinutesThisWeek: fresh.myMinutesThisWeek ?? prev?.myMinutesThisWeek ?? 0,
          }),
        );
      }
      qc.invalidateQueries({ queryKey: queryKeys.customerTicketsRoot(customerId) });
      // A task panel's ticket chip reads the by-ref cache — refresh it too.
      qc.invalidateQueries({ queryKey: queryKeys.itopTicketByRefRoot });
      qc.invalidateQueries({ queryKey: queryKeys.itopDailyRoot });
    },
  });
}

// ---- New ticket sheet (Task 6.2, docs/archive/plans/itop-integration.md) --
// Backend: GET /itop/services (global catalogue), GET
// /itop/customers/:id/contacts (the org's callers, [] when unmapped), POST
// /itop/tickets (creates under the customer's org with the caller's own
// token). No optimistic writes — same "no queued or optimistic writes" rule
// as the ticket panel above.
export interface ItopServiceOption {
  id: number;
  name: string;
  providerName: string | null;
}

export interface ItopContactOption {
  id: number;
  name: string;
  email: string;
}

export function useItopServices() {
  return useQuery({
    queryKey: queryKeys.itopServices,
    queryFn: ({ signal }) => apiRequest<ItopServiceOption[]>("/itop/services", { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useItopContacts(customerId: number) {
  return useQuery({
    queryKey: queryKeys.itopContacts(customerId),
    queryFn: ({ signal }) =>
      apiRequest<ItopContactOption[]>(`/itop/customers/${customerId}/contacts`, { signal }),
    staleTime: 60_000,
  });
}

export interface CreateTicketInput {
  customerId: number;
  class: ItopTicketClass;
  title: string;
  description: string;
  callerId: number;
  serviceId?: number;
}

// 201: the created ticket, read back from iTop (same shape as GET
// /itop/tickets/:id). 202: iTop accepted the create but the follow-up read
// failed — `staleAfterWrite` tells the caller the id exists but its fields
// aren't available yet (NewTicketSheet.tsx shows "appears after the next
// sync" rather than opening a panel it can't populate).
export interface ItopTicketCreateStale {
  created: true;
  id: number;
  staleAfterWrite: true;
}

export type ItopTicketCreateResult = ItopTicketDetail | ItopTicketCreateStale;

/** True for the 202 shape — the created ticket has no `ref`/`title`/etc. yet. */
export function isStaleTicketCreate(
  result: ItopTicketCreateResult,
): result is ItopTicketCreateStale {
  return "created" in result && result.created === true;
}

export function useCreateTicket(customerId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) =>
      apiRequest<ItopTicketCreateResult>("/itop/tickets", { method: "POST", body: input }),
    onSuccess: (result) => {
      // 201 only — a 202 stale create's shape has no ticket fields to seed
      // the cache with yet (see `ItopTicketCreateStale`). Seeding this
      // BEFORE `NewTicketSheet.tsx` opens the panel on the new id avoids a
      // redundant loading flash there (`useItopTicket` finds the row
      // already cached).
      if (!isStaleTicketCreate(result)) {
        // A brand-new ticket has no prior cache entry to merge a
        // `myMinutesThisWeek` from (fix round, phase review) — 0 is simply
        // right for a ticket nobody has logged time on yet.
        qc.setQueryData(queryKeys.itopTicket(result.id), {
          ...result,
          myMinutesThisWeek: result.myMinutesThisWeek ?? 0,
        });
      }
      qc.invalidateQueries({ queryKey: queryKeys.customerTicketsRoot(customerId) });
      // A task panel's ticket chip reads the by-ref cache — refresh it too.
      qc.invalidateQueries({ queryKey: queryKeys.itopTicketByRefRoot });
      qc.invalidateQueries({ queryKey: queryKeys.itopDailyRoot });
    },
  });
}

// Daily Review's iTop strip (Task 2.2, docs/archive/plans/itop-integration.md):
// one call per rendered day (not per customer — the Daily Review page fetches
// this once and hands each CustomerGroup its own slice), backed by GET
// /itop/daily. `configured: false` (no iTop connection at all) or a customer
// simply missing from `customers` (not mapped to an iTop org, or not visible
// to the caller) both mean "no strip for that customer" — DailyItopStrip.tsx
// callers just look up the slice and render nothing when it's absent.
export interface DailyItopCustomer {
  customerId: number;
  customerName: string;
  orgName: string | null;
  counts: { newToday: number; resolvedToday: number; slaBreached: number; ongoing: number };
  // Max 3, lastUpdate desc — same row shape as the Customer Tickets tab.
  recent: ItopTicketRow[];
  syncedAt: string | null;
}

export interface DailyItopResponse {
  configured: boolean;
  date: string;
  customers: DailyItopCustomer[];
}

export function useItopDaily(date: string, { enabled = true }: { enabled?: boolean } = {}) {
  // Local minus UTC, in minutes (UTC+7 = 420) — `getTimezoneOffset()` is the
  // inverse of that convention (UTC minus local), hence the negation. Sent
  // so the backend can bucket "today"/"resolved today" by the viewer's
  // local day rather than server-local or UTC (user decision).
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  return useQuery({
    queryKey: queryKeys.itopDaily(date, utcOffsetMinutes),
    queryFn: ({ signal }) =>
      apiRequest<DailyItopResponse>(
        `/itop/daily?date=${encodeURIComponent(date)}&utcOffsetMinutes=${utcOffsetMinutes}`,
        { signal },
      ),
    enabled,
    staleTime: 30_000,
    // A function, not a flat 60s: an unconfigured install (or a route that's
    // erroring, e.g. before the backend half of this task lands) leaves
    // `data` undefined/`configured: false`, and there's nothing to poll for
    // in either case — polling anyway would just hammer a 404 or a stub
    // response every minute for every open Daily Review tab.
    refetchInterval: (query) => (query.state.data?.configured ? 60_000 : false),
    refetchIntervalInBackground: false,
  });
}

// Utilization page (Task 3.3, docs/archive/plans/itop-integration.md — "Work
// Logs becomes Utilization" in docs/archive/plans/itop-integration-spec.md):
// hours per TAM per customer for a given ISO week, backed by GET
// /utilization. `me` is readable by anyone; `tam`/`customer` require
// `report:executive` (backend 403s otherwise) — Utilization.tsx clamps the
// requested scope to "me" client-side before this hook ever fires for a
// caller without that permission, so the 403 path is a defense-in-depth
// backstop, not something this hook needs to special-case. No polling: the
// week table isn't a live dashboard like the Daily Review strip, so a
// manual Refresh (`useRequestItopRefresh`, same mutation as the Tickets tab)
// plus this hook's own 30s staleTime is enough.
export type UtilizationScope = "me" | "tam" | "customer";

export interface UtilizationTilesData {
  hoursLogged: number;
  /** Capacity × people in scope (e.g. one TAM's 40 h for `scope=me`). */
  capacityHours: number;
  customersTouched: number;
  customersAssigned: number;
  unassignedHours: number;
}

export interface UtilizationRow {
  key: string;
  label: string;
  kind: "customer" | "tam" | "none";
  /** Decimal hours, Monday..Sunday, 0 = none logged that day. */
  hours: number[];
  total: number;
  /** Distinct ticket refs, most hours first, max 6. */
  ticketRefs: string[];
}

export interface UtilizationResponse {
  configured: boolean;
  week: { key: string; start: string; days: string[] };
  scope: UtilizationScope;
  capacityHoursPerWeek: number;
  syncedAt: string | null;
  tiles: UtilizationTilesData;
  rows: UtilizationRow[];
  totals: { hours: number[]; total: number };
  /** Echoes the request's `utcOffsetMinutes` (local minus UTC) — same contract as `/itop/daily`. */
  utcOffsetMinutes: number;
  /** True when the week's raw TimeSpent entries exceeded the backend's row cap (10,000) before aggregation. */
  truncated: boolean;
}

export function useUtilization(
  week: string,
  scope: UtilizationScope,
  { enabled = true }: { enabled?: boolean } = {},
) {
  // Local minus UTC, in minutes — same computation and rationale as
  // useItopDaily above: sent so the backend can bucket by the viewer's
  // local day/week rather than server-local or UTC.
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  return useQuery({
    queryKey: queryKeys.utilization(week, scope, utcOffsetMinutes),
    queryFn: ({ signal }) =>
      apiRequest<UtilizationResponse>(
        `/utilization?week=${encodeURIComponent(week)}&scope=${scope}&utcOffsetMinutes=${utcOffsetMinutes}`,
        { signal },
      ),
    enabled,
    staleTime: 30_000,
  });
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  active: boolean;
  role: Role;
  createdAt: string;
  provider: "google" | "password";
  avatarUrl: string | null;
  projectsAsTAM: number;
}

export interface AuthSettings {
  googleClientId: string | null;
  googleAllowedDomains: string[];
  updatedAt: string;
  updatedBy: { id: number; username: string } | null;
}

// Public — no auth required. Used by Login.tsx to decide whether to render
// the Google button and what audience to initialise GoogleOAuthProvider with.
export interface GoogleAuthRuntimeConfig {
  clientId: string | null;
  enabled: boolean;
}

export interface AdminProject {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  tamId: number;
  customerId: number | null;
  createdAt: string;
  updatedAt: string;
  tam: { id: number; username: string };
  customer: { id: number; name: string } | null;
  _count: { tasks: number };
}

export const adminQueryKeys = {
  users: ["admin", "users"] as const,
  projects: ["admin", "projects"] as const,
  roles: ["admin", "roles"] as const,
  authSettings: ["admin", "settings", "auth"] as const,
  itopSettings: ["admin", "itop", "settings"] as const,
  itopOrganizations: ["admin", "itop", "organizations"] as const,
  itopCustomers: ["admin", "itop", "customers"] as const,
  itopPersons: ["admin", "itop", "persons"] as const,
  outlineSettings: ["admin", "settings", "outline"] as const,
};

export interface AdminRole {
  id: number;
  roleName: string;
  permissions: string[];
  userCount: number;
  builtIn: boolean;
}

export function useAdminRoles() {
  return useQuery({
    queryKey: adminQueryKeys.roles,
    queryFn: ({ signal }) => apiRequest<AdminRole[]>("/admin/roles", { signal }),
  });
}

export function useAdminCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roleName: string; permissions: string[] }) =>
      apiRequest<AdminRole>("/admin/roles", { method: "POST", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.roles });
    },
  });
}

export function useAdminUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      permissions,
      roleName,
    }: {
      id: number;
      permissions: string[];
      /** Optional rename. Backend rejects for reserved roles (PENDING). */
      roleName?: string;
    }) =>
      apiRequest<AdminRole>(`/admin/roles/${id}`, {
        method: "PATCH",
        body: roleName ? { permissions, roleName } : { permissions },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.roles });
      qc.invalidateQueries({ queryKey: adminQueryKeys.users });
    },
  });
}

export function useAdminDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/admin/roles/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.roles });
      qc.invalidateQueries({ queryKey: adminQueryKeys.users });
    },
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: adminQueryKeys.users,
    queryFn: ({ signal }) => apiRequest<AdminUser[]>("/admin/users", { signal }),
  });
}

export function useAdminCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email: string;
      username: string;
      password: string;
      role: Role;
    }) =>
      apiRequest<AdminUser>("/admin/users", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.users });
      qc.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useAdminUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) =>
      apiRequest<AdminUser>(`/admin/users/${id}/role`, {
        method: "PATCH",
        body: { role },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.users });
      qc.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useAdminSetActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiRequest<AdminUser>(`/admin/users/${id}/deactivate`, {
        method: "PATCH",
        body: { active },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.users });
      qc.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useChangeMyPassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      // Requests already in flight answer 401 once the server has bumped the
      // token version; api.ts must not read that as a sign-out meanwhile.
      setTokenRotating(true);
      try {
        const res = await apiRequest<{ token: string }>("/auth/change-password", {
          method: "POST",
          body: input,
        });
        // The change revoked the token this tab holds: store the replacement
        // before any other request fires, so none is sent with the stale one.
        setToken(res.token);
        return res;
      } finally {
        setTokenRotating(false);
      }
    },
  });
}

export function useAdminResetPassword() {
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<{ tempPassword: string }>(
        `/admin/users/${id}/reset-password`,
        { method: "POST" },
      ),
  });
}

export function useAdminDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.users });
      qc.invalidateQueries({ queryKey: queryKeys.users });
      qc.invalidateQueries({ queryKey: adminQueryKeys.roles });
    },
  });
}

export function useAdminProjects() {
  return useQuery({
    queryKey: adminQueryKeys.projects,
    queryFn: ({ signal }) =>
      apiRequest<AdminProject[]>("/admin/projects", { signal }),
  });
}

export function useAdminReassignProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, newTamId }: { projectId: number; newTamId: number }) =>
      apiRequest<AdminProject>("/admin/projects/reassign", {
        method: "PUT",
        body: { projectId, newTamId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.projects });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useAuthSettings() {
  return useQuery({
    queryKey: adminQueryKeys.authSettings,
    queryFn: ({ signal }) =>
      apiRequest<AuthSettings>("/admin/settings/auth", { signal }),
  });
}

export interface UpdateAuthSettingsInput {
  googleClientId?: string | null;
  googleAllowedDomains?: string[];
}

export function useUpdateAuthSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAuthSettingsInput) =>
      apiRequest<AuthSettings>("/admin/settings/auth", {
        method: "PATCH",
        body: input,
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(adminQueryKeys.authSettings, fresh);
      // The public runtime config could have flipped enabled/disabled —
      // refetch so the Login page picks up the new state on next mount.
      qc.invalidateQueries({ queryKey: ["auth", "google", "config"] });
    },
  });
}

// Public runtime config for the Login page (no auth required).
export function useGoogleAuthConfig() {
  return useQuery({
    queryKey: ["auth", "google", "config"] as const,
    queryFn: ({ signal }) =>
      apiRequest<GoogleAuthRuntimeConfig>("/auth/google/config", {
        signal,
        auth: false,
      }),
    staleTime: 60_000,
  });
}

// ---- iTop admin (Task 1.6) --------------------------------------------
// Connection settings, org↔customer mapping, and the user↔iTop-person match
// report behind the Admin "iTop" tab. Backend: routes/itopAdmin.ts, mounted
// at /admin/itop (docs/archive/plans/itop-integration.md §2 deviation 4) —
// deliberately its own router, not routes/admin.ts. Kept as one contiguous
// block per the plan's spine-file convention for lib/queries.ts.

export type ItopReadClass = "UserRequest" | "Incident";

export interface ItopProbeResult {
  name: string;
  ok: boolean;
  message: string;
}

export interface ItopSettings {
  baseUrl: string | null;
  appTokenSet: boolean;
  webhookSecretSet: boolean;
  refreshMinutes: number;
  readClasses: ItopReadClass[];
  capacityHoursPerWeek: number;
  actionsEnabled: boolean;
  // IANA zone name the real iTop install's own server clock runs on (e.g.
  // "Europe/Paris") — ground truth confirmed 2026-09-24: iTop stores/returns
  // ticket timestamps in ITS OWN timezone, not UTC, so a mismatched default
  // ("UTC") showed times off by that offset. Defaults to "UTC" on the
  // backend for an unconfigured install.
  timezone: string;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
  lastFullSyncAt: string | null;
  updatedAt: string;
  updatedBy: { id: number; username: string } | null;
}

// All fields optional: `undefined` (omitted) leaves the column alone on the
// backend, `null` clears baseUrl. appToken has no clear affordance in this
// UI (see ItopTab.tsx) but the backend accepts `null` there too.
export interface UpdateItopSettingsInput {
  baseUrl?: string | null;
  appToken?: string | null;
  refreshMinutes?: number;
  readClasses?: ItopReadClass[];
  capacityHoursPerWeek?: number;
  actionsEnabled?: boolean;
  /** 400 `invalid_timezone` from the backend for a name `Intl` can't resolve. */
  timezone?: string;
}

export interface ItopTestConnectionInput {
  baseUrl?: string;
  appToken?: string;
}

export interface ItopTestResult {
  ok: boolean;
  probes: ItopProbeResult[];
}

// POST /admin/itop/sync is fire-and-forget on the backend (routes/itopAdmin.ts):
// a full first sync of a real install can run past nginx's proxy timeout, so
// the route kicks syncTickets() off in the background and answers 202
// immediately — it never returns sync counts inline. `lastSyncAt` on the
// `started: true` branch is the value from *before* this run, useful only as
// a "did it actually update yet" baseline while polling useItopSettings.
export interface ItopSyncStarted {
  started: true;
  lastSyncAt: string | null;
}

export interface ItopSyncNotStarted {
  started: false;
  reason: string;
}

export type ItopSyncResult = ItopSyncStarted | ItopSyncNotStarted;

export interface ItopOrganization {
  id: number;
  name: string;
  mappedCustomerId: number | null;
}

export type ItopCustomerMatch = "name" | "manual" | "unmatched";

export interface ItopCustomerRow {
  id: number;
  name: string;
  itopOrgId: number | null;
  itopOrgName: string | null;
  match: ItopCustomerMatch;
}

export interface ItopPersonRow {
  id: number;
  username: string;
  email: string;
  itopPersonId: number | null;
  itopUserId: number | null;
  matched: boolean;
}

export interface ItopPersonsResponse {
  users: ItopPersonRow[];
  unmatched: number;
}

// ---- Outline links (docs/archive/plans/outline-integration.md, Phase A) -----
// Solvro only links to Outline: a base URL for the sidebar item, and optional
// per-project / per-customer links. No Outline API is called.

export interface OutlineConfig {
  baseUrl: string | null;
}

export function useOutlineConfig() {
  return useQuery({
    queryKey: queryKeys.outlineConfig,
    queryFn: ({ signal }) => apiRequest<OutlineConfig>("/outline/config", { signal }),
    staleTime: 10 * 60_000,
  });
}

export interface OutlineAdminSettings {
  baseUrl: string | null;
  /** The OAuth client id registered in Outline; the secret is write-only (only `…Set` is returned). */
  oauthClientId: string | null;
  oauthClientSecretSet: boolean;
  webhookSecretSet: boolean;
  lastWebhookAt: string | null;
  /** False when the server has no APP_URL (production has no default). */
  appUrlConfigured: boolean;
  appUrlWarning: string | null;
  /** Browser-facing URLs to register in Outline; null while APP_URL is unset. */
  redirectUri: string | null;
  webhookUrl: string | null;
  updatedAt: string;
  updatedBy: { id: number; username: string } | null;
}

export function useOutlineAdminSettings() {
  return useQuery({
    queryKey: adminQueryKeys.outlineSettings,
    queryFn: ({ signal }) =>
      apiRequest<OutlineAdminSettings>("/admin/settings/outline", { signal }),
  });
}

export function useUpdateOutlineAdminSettings() {
  const qc = useQueryClient();
  return useMutation({
    // Partial: omitted fields are kept. `oauthClientSecret` is write-only; null clears.
    mutationFn: (input: {
      baseUrl?: string | null;
      oauthClientId?: string | null;
      oauthClientSecret?: string | null;
    }) =>
      apiRequest<OutlineAdminSettings>("/admin/settings/outline", {
        method: "PATCH",
        body: input,
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(adminQueryKeys.outlineSettings, fresh);
      // The sidebar item reads the user-facing copy of the same value.
      qc.invalidateQueries({ queryKey: queryKeys.outlineConfig });
      // Changing the address or the OAuth client disconnects every user server-side.
      qc.invalidateQueries({ queryKey: queryKeys.outlineMe });
      qc.invalidateQueries({ queryKey: queryKeys.outlineDocsAll });
      qc.removeQueries({ queryKey: queryKeys.outlineMentionsAll });
      qc.removeQueries({ queryKey: queryKeys.outlineSearchAll });
    },
  });
}

// ---- Outline inside Solvro (B6: docs/archive/plans/outline-integration.md) ----
// Connect card (Settings), Docs tab + New doc dialog, and the Admin API/webhook
// cards. Every Outline call runs under the signed-in user's own OAuth token on the
// server; none of these hooks ever carries a token or page text.

export interface OutlineMe {
  configured: boolean;
  connected: boolean;
  outlineEmail: string | null;
  expiresAt: string | null;
}

/** Pass `enabled = false` until the Outline address is known to be set: no Outline, no request. */
export function useOutlineMe(enabled = true) {
  return useQuery({
    queryKey: queryKeys.outlineMe,
    queryFn: ({ signal }) => apiRequest<OutlineMe>("/outline/me", { signal }),
    staleTime: 60_000,
    enabled,
  });
}

/** Starts the OAuth connection: resolves to Outline's authorize URL (a top-level navigation target). */
export function useStartOutlineConnect() {
  return useMutation({
    mutationFn: () =>
      apiRequest<{ authorizeUrl: string }>("/outline/oauth/start", { method: "POST" }),
  });
}

export function useDisconnectOutline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>("/outline/me", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.outlineMe });
      qc.invalidateQueries({ queryKey: queryKeys.outlineDocsAll });
      qc.removeQueries({ queryKey: queryKeys.outlineTemplates });
      // B7's Outline-backed data holds page titles the user can no longer open.
      qc.removeQueries({ queryKey: queryKeys.outlineMentionsAll });
      qc.removeQueries({ queryKey: queryKeys.outlineSearchAll });
    },
  });
}

export type OutlineDocsScope = "projects" | "customers";

export interface OutlineDocNode {
  id: string;
  title: string;
  /** Absolute Outline URL. */
  url: string;
  children: OutlineDocNode[];
}

/** What the Docs tab shows for the link: null anchor = no link; the flag states carry no tree. */
export interface OutlineDocsResponse {
  anchor:
    | null
    | { outside: true }
    | { unsupported: true }
    | { hidden: true }
    | { kind: "doc" | "collection"; title: string; url: string };
  tree?: OutlineDocNode[];
}

/** Errors that a retry cannot fix: not connected (409), rate limited (429), reconnect needed. */
function noRetryOnOutlineError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [404, 409, 429].includes(error.status)) return false;
  return failureCount < 1;
}

export function useOutlineDocs(scope: OutlineDocsScope, id: number | null) {
  return useQuery({
    queryKey: queryKeys.outlineDocs(scope, id ?? 0),
    queryFn: ({ signal }) =>
      apiRequest<OutlineDocsResponse>(`/${scope}/${id}/outline/docs`, { signal }),
    enabled: id !== null,
    // The server caches the tree for 60 s per user (Outline's rate limit is shared).
    staleTime: 60_000,
    retry: noRetryOnOutlineError,
  });
}

export interface OutlineTemplate {
  id: string;
  title: string;
}

export function useOutlineTemplates(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.outlineTemplates,
    queryFn: ({ signal }) => apiRequest<OutlineTemplate[]>("/outline/templates", { signal }),
    enabled,
    staleTime: 5 * 60_000,
    retry: noRetryOnOutlineError,
  });
}

export interface CreateOutlineDocInput {
  title: string;
  templateId?: string;
  parentDocumentId?: string;
  publish: boolean;
}

export function useCreateOutlineDoc(scope: OutlineDocsScope, id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOutlineDocInput) =>
      apiRequest<{ id: string; title: string; url: string }>(`/${scope}/${id}/outline/docs`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.outlineDocs(scope, id) });
    },
  });
}

/** Generates a new webhook signing secret; the plaintext is in the response and never again. */
export function useRotateOutlineWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ webhookSecret: string }>("/admin/settings/outline/webhook-secret/rotate", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.outlineSettings });
    },
  });
}
// ---- end Outline inside Solvro (B6) ----

export function useItopSettings() {
  return useQuery({
    queryKey: adminQueryKeys.itopSettings,
    queryFn: ({ signal }) =>
      apiRequest<ItopSettings>("/admin/itop/settings", { signal }),
  });
}

export function useUpdateItopSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateItopSettingsInput) =>
      apiRequest<ItopSettings>("/admin/itop/settings", {
        method: "PATCH",
        body: input,
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(adminQueryKeys.itopSettings, fresh);
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopSettings });
    },
  });
}

// Webhook secret (Task 4.1, docs/archive/plans/itop-integration.md): the
// secret itself is shown exactly once, in the mutation's response — it's
// never re-readable, so ItopTab.tsx keeps it in local component state and
// these hooks only ever invalidate `itopSettings` (whose `webhookSecretSet`
// boolean is the only trace of it that persists across a remount).
export interface ItopWebhookSecretResult {
  secret: string;
  path: string;
  header: string;
}

export function useGenerateItopWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    // Also used to rotate an existing secret — same endpoint, same one-time
    // response shape; the old secret simply stops verifying.
    mutationFn: () =>
      apiRequest<ItopWebhookSecretResult>("/admin/itop/webhook-secret", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopSettings });
    },
  });
}

export function useRemoveItopWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<void>("/admin/itop/webhook-secret", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopSettings });
    },
  });
}

// No invalidation: a test run never persists anything server-side.
export function useTestItopConnection() {
  return useMutation({
    mutationFn: (input: ItopTestConnectionInput) =>
      apiRequest<ItopTestResult>("/admin/itop/test", {
        method: "POST",
        body: input,
      }),
  });
}

export function useItopSyncNow() {
  const qc = useQueryClient();
  function refetchSyncedState() {
    qc.invalidateQueries({ queryKey: adminQueryKeys.itopSettings });
    qc.invalidateQueries({ queryKey: adminQueryKeys.itopCustomers });
  }
  return useMutation({
    mutationFn: (input: { full?: boolean } = {}) =>
      apiRequest<ItopSyncResult>("/admin/itop/sync", {
        method: "POST",
        body: input,
      }),
    onSuccess: (result) => {
      refetchSyncedState();
      // The sync itself finishes on the server after this 202 response — poll
      // twice more so the "Synced … · ok" line and the customer mapping
      // table pick up the result without the admin needing to hit refresh.
      if (result.started) {
        setTimeout(refetchSyncedState, 3_000);
        setTimeout(refetchSyncedState, 15_000);
      }
    },
  });
}

export function useItopOrganizations() {
  return useQuery({
    queryKey: adminQueryKeys.itopOrganizations,
    queryFn: ({ signal }) =>
      apiRequest<ItopOrganization[]>("/admin/itop/organizations", { signal }),
    // Live iTop reads, not snapshot data — cheap to skip refetching for a
    // minute, and never worth retrying automatically: a 502/409 here means
    // iTop is unreachable or unconfigured, not a transient network blip.
    staleTime: 60_000,
    retry: false,
  });
}

export function useItopCustomers() {
  return useQuery({
    queryKey: adminQueryKeys.itopCustomers,
    queryFn: ({ signal }) =>
      apiRequest<ItopCustomerRow[]>("/admin/itop/customers", { signal }),
  });
}

export function useMapItopCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itopOrgId }: { id: number; itopOrgId: number | null }) =>
      apiRequest<ItopCustomerRow>(`/admin/itop/customers/${id}`, {
        method: "PATCH",
        body: { itopOrgId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopCustomers });
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopOrganizations });
    },
  });
}

export function useAutomatchItopCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ matched: number; customers: ItopCustomerRow[] }>(
        "/admin/itop/customers/automatch",
        { method: "POST" },
      ),
    onSuccess: (fresh) => {
      qc.setQueryData(adminQueryKeys.itopCustomers, fresh.customers);
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopCustomers });
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopOrganizations });
    },
  });
}

export function useItopPersons() {
  return useQuery({
    queryKey: adminQueryKeys.itopPersons,
    queryFn: ({ signal }) =>
      apiRequest<ItopPersonsResponse>("/admin/itop/persons", { signal }),
  });
}

export function useMatchItopPersons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<ItopPersonsResponse>("/admin/itop/persons/match", {
        method: "POST",
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(adminQueryKeys.itopPersons, fresh);
      qc.invalidateQueries({ queryKey: adminQueryKeys.itopPersons });
    },
  });
}

export interface Holiday {
  date: string;
  name: string;
  type: string;
}

export function useHolidays(years: number[]) {
  const uniq = Array.from(new Set(years)).sort((a, b) => a - b);
  return useQueries({
    queries: uniq.map((y) => ({
      queryKey: ["holidays", y] as const,
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        apiRequest<Holiday[]>(`/holidays?year=${y}`, { signal }),
      staleTime: 24 * 60 * 60 * 1000,
    })),
    combine: (results) => ({
      data: results.flatMap((r) => r.data ?? []),
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Network Diagram (Dependency View) — TaskDependency rows
// ─────────────────────────────────────────────────────────────────────────

export type DependencyType = "HARD" | "SOFT";

export interface TaskDependency {
  id: number;
  projectId: number;
  predecessorTaskId: number;
  successorTaskId: number;
  type: DependencyType;
  // Diagram routing hints (which handle the user dragged from/to);
  // null means "use defaults" — right-source → left-target.
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: string;
}

export interface CreateDependencyInput {
  predecessorTaskId: number;
  successorTaskId: number;
  type?: DependencyType;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function useProjectDependencies(projectId: number | null) {
  const live = useLiveRefresh();
  return useQuery({
    ...live,
    queryKey: projectId
      ? queryKeys.projectDependencies(projectId)
      : ["projects", "noop", "dependencies"],
    queryFn: ({ signal }) =>
      apiRequest<TaskDependency[]>(`/projects/${projectId}/dependencies`, { signal }),
    enabled: projectId !== null,
  });
}

export function useCreateDependency(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDependencyInput) =>
      apiRequest<TaskDependency>(`/projects/${projectId}/dependencies`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectDependencies(projectId) });
    },
  });
}

export function useUpdateDependency(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, type }: { id: number; type: DependencyType }) =>
      apiRequest<TaskDependency>(`/dependencies/${id}`, {
        method: "PATCH",
        body: { type },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectDependencies(projectId) });
    },
  });
}

export function useDeleteDependency(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/dependencies/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectDependencies(projectId) });
    },
  });
}

// ---- Outline in Solvro, part 2 (B7: docs/archive/plans/outline-integration.md) ----
// ⌘K "Outline" group (its OWN query, so Solvro results never wait on Outline) and
// "Mentioned in Outline" on a task / project. Both run under the signed-in user's
// own Outline token on the server and carry no page text.

export interface OutlineSearchResult {
  id: string;
  title: string;
  /** Absolute Outline URL; still goes through `safeOutlineHref` before it reaches an href. */
  url: string;
  /** Plain-text segments with highlight flags - rendered as text, never as HTML. */
  snippet: OutlineSnippetSegment[];
}

export function useOutlineSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.outlineSearch(q),
    queryFn: ({ signal }) =>
      apiRequest<OutlineSearchResult[]>(`/outline/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: enabled && q.trim().length >= 2,
    // Outline's search limit is shared by every Solvro user (one client IP).
    staleTime: 60_000,
    retry: noRetryOnOutlineError,
    // Keep the previous rows up while the next keystroke's query is in flight; the
    // palette gates consumption on its live query, so a reopen never shows them.
    placeholderData: (prev) => prev,
  });
}

export function useTaskOutlineMentions(taskId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.taskOutlineMentions(taskId),
    queryFn: ({ signal }) =>
      apiRequest<OutlineMentionsData>(`/tasks/${taskId}/outline-mentions`, { signal }),
    enabled,
    // The server caches per-viewer page access for 5 minutes; a minute is plenty here.
    staleTime: 60_000,
    retry: noRetryOnOutlineError,
  });
}

export function useProjectOutlineMentions(projectId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectOutlineMentions(projectId),
    queryFn: ({ signal }) =>
      apiRequest<OutlineMentionsData>(`/projects/${projectId}/outline-mentions`, { signal }),
    enabled,
    staleTime: 60_000,
    retry: noRetryOnOutlineError,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Executive dashboard — org-wide portfolio roll-up (GET /reports/executive)
// ─────────────────────────────────────────────────────────────────────────

export interface ExecutiveReport {
  projects: PortfolioProjectRow[];
  generatedAt: string;
}

export function useExecutiveReport() {
  // Same client-day contract as useOverview() above — see that hook's
  // comment for why `today` must be part of the query key, not just the URL,
  // and for the placeholderData rationale below.
  const today = dateToDay(new Date())!;
  return useQuery({
    queryKey: [...queryKeys.executiveReport(), today],
    queryFn: ({ signal }) =>
      apiRequest<ExecutiveReport>(`/reports/executive?today=${today}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

