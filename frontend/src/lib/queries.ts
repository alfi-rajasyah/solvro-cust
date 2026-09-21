import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { useAuth, type Role } from "./auth";
import { dateToDay, dayFromIso, isoFromDay } from "./dateField";
import { parseWeekKey } from "./isoWeek";
import type { PipelineStage } from "./pipelineFormat";

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
  permissions: string[];
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

export interface CustomerSummary {
  id: number;
  name: string;
  accountManager: string | null;
  solutionArchitect: string | null;
  description: string;
  createdAt: string;
  // TAM ownership (Decision 8, daily-review-v2-spec.md §3) — gated by
  // `project:write`, the same permission the customer form already requires.
  tamId: number | null;
  tam: { id: number; username: string } | null;
  _count: { projects: number };
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

export interface ProjectSummary {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  saId: number | null;
  tamId: number;
  customerId: number | null;
  wipLimits: WipLimits | null;
  /** Administrative container (e.g. Opty Timelines) — hidden from portfolio roll-ups. */
  excludeFromPortfolio: boolean;
  baselineLockedAt: string | null;
  baselineLockedById: number | null;
  createdAt: string;
  updatedAt: string;
  sa: { id: number; username: string } | null;
  tam: { id: number; username: string };
  customer: { id: number; name: string } | null;
  _count: { tasks: number };
}

export interface ProjectDetail extends ProjectSummary {
  sa: { id: number; username: string; email: string } | null;
  tam: { id: number; username: string; email: string };
  customer: { id: number; name: string } | null;
  baselineLockedBy: { id: number; username: string } | null;
  services: ProjectServiceAssignment[];
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
  position: number;
  labels: Label[];
  _count: { subtasks: number; comments: number };
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
  topLevel?: boolean;
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
  overview: ["overview"] as const,
  users: ["users"] as const,
  projects: (filter?: ProjectsFilter) => ["projects", filter ?? {}] as const,
  project: (id: number) => ["projects", id] as const,
  projectTasks: (id: number) => ["projects", id, "tasks"] as const,
  projectLabels: (id: number) => ["projects", id, "labels"] as const,
  projectSections: (id: number) => ["projects", id, "sections"] as const,
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
  tasks: (filter?: TasksFilter) => ["tasks", filter ?? {}] as const,
  comments: (taskId: number) => ["tasks", taskId, "comments"] as const,
  search: (q: string) => ["search", q] as const,
  executiveReport: () => ["executive-report"] as const,
  // `today` is folded into the key by the caller (see useDailyReview) —
  // same day-boundary rationale as useOverview/useExecutiveReport below.
  dailyReview: (week: string, today: string) => ["daily-review", week, today] as const,
  // The bare prefix every `dailyReview(...)` key extends — the
  // invalidate-everything-daily-review-related root every mutation below
  // uses (same shape as `pipelineKeys.root`), rather than ~20 repeated
  // `["daily-review"]` array literals that could each silently drift.
  dailyReviewRoot: ["daily-review"] as const,
  // Overview's "Recent notes" feed (GET /notes/recent). `today` is folded
  // into the key by useRecentNotes — same day-boundary rationale as
  // useOverview. `recentNotesRoot` is the prefix every note mutation below
  // invalidates, so a note saved on the Daily Review shows up on the
  // Overview without waiting out staleTime.
  recentNotes: (today: string) => ["recent-notes", today] as const,
  recentNotesRoot: ["recent-notes"] as const,
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

// Powers the ⌘K command palette (CommandPalette.tsx). `enabled` gates on the
// backend's own 2-char minimum (search.ts's Zod schema) so we never fire a
// request that's guaranteed to 400. `placeholderData` keeps the previous
// page of results rendered while the next keystroke's query is in flight —
// prevents the list flashing empty on every char.
export function useSearch(q: string) {
  return useQuery<SearchResults>({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) =>
      apiRequest<SearchResults>(`/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: ({ signal }) => apiRequest<UserSummary[]>("/users", { signal }),
    staleTime: 60_000,
  });
}

export function useProjects(filter: ProjectsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.customerId) params.set("customerId", String(filter.customerId));
  const qs = params.toString();
  return useQuery({
    queryKey: queryKeys.projects(filter),
    queryFn: ({ signal }) =>
      apiRequest<ProjectSummary[]>(`/projects${qs ? `?${qs}` : ""}`, { signal }),
  });
}

export function useCustomers() {
  return useQuery({
    queryKey: queryKeys.customers,
    queryFn: ({ signal }) => apiRequest<CustomerSummary[]>("/customers", { signal }),
    staleTime: 30_000,
  });
}

export function useCustomer(id: number | null) {
  return useQuery({
    queryKey: id ? queryKeys.customer(id) : ["customers", "noop"],
    queryFn: ({ signal }) =>
      apiRequest<CustomerDetail>(`/customers/${id}`, { signal }),
    enabled: id !== null,
  });
}

export function useProject(id: number | null) {
  return useQuery({
    queryKey: id ? queryKeys.project(id) : ["projects", "noop"],
    queryFn: ({ signal }) =>
      apiRequest<ProjectDetail>(`/projects/${id}`, { signal }),
    enabled: id !== null,
  });
}

export function useProjectTasks(id: number | null) {
  return useQuery({
    queryKey: id ? queryKeys.projectTasks(id) : ["projects", "noop", "tasks"],
    queryFn: ({ signal }) =>
      apiRequest<Task[]>(`/projects/${id}/tasks`, { signal }),
    enabled: id !== null,
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

export function useTasks(filter: TasksFilter = {}) {
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
  if (filter.topLevel) params.set("topLevel", "true");
  const qs = params.toString();
  return useQuery({
    // `qs` (not just `filter`) is part of the key: `today` lives only in
    // `qs`, recomputed fresh each render this hook runs, so the key
    // naturally changes the next time the component re-renders after local
    // midnight — without it in the key, that re-render would still hit the
    // pre-midnight cache entry for an unchanged `{overdue:true}` filter
    // instead of refetching against the new day.
    queryKey: [...queryKeys.tasks(filter), qs],
    queryFn: ({ signal }) =>
      apiRequest<TaskWithProject[]>(`/tasks${qs ? `?${qs}` : ""}`, { signal }),
    // See useOverview()'s comment: avoids a skeleton flash on the render
    // where the day-boundary key change lands.
    placeholderData: (prev) => prev,
  });
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  saId?: number;
  tamId?: number;
  customerId: number;
  status?: ProjectStatus;
  wipLimits?: WipLimits | null;
  excludeFromPortfolio?: boolean;
}

// The bare row `prisma.project.create` returns (backend/src/routes/
// projects.ts's POST "/" — and POST /opportunities/:id/handoff below, which
// mirrors that same `prisma.project.create` call verbatim) — no `sa`/`tam`/
// `customer`/`_count`, unlike `ProjectSummary`, which only reflects GET
// /projects's own `include`. `ProjectSummary` was mistyped here (finding
// N5): nothing currently reads more than `.id` off this result, so it
// never surfaced as a runtime bug, but a caller trusting the type to read
// e.g. `.tam.username` off a freshly-created project would silently get
// `undefined` with no type error to catch it.
export type CreatedProject = Omit<ProjectSummary, "sa" | "tam" | "customer" | "_count">;

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
  status?: ProjectStatus;
  saId?: number | null;
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
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      // excludeFromPortfolio changes reshape the executive roll-up too.
      qc.invalidateQueries({ queryKey: queryKeys.executiveReport() });
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
      // its cascaded tasks — plus the pipeline, where the linked won deal's
      // `projectId` just went null (the inverse of useHandoffOpportunity).
      qc.removeQueries({ queryKey: queryKeys.project(id) });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: adminQueryKeys.projects });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
      qc.invalidateQueries({ queryKey: queryKeys.recentNotesRoot });
      qc.invalidateQueries({ queryKey: queryKeys.executiveReport() });
      qc.invalidateQueries({ queryKey: pipelineKeys.root });
    },
  });
}

export interface CustomerInput {
  name: string;
  accountManager?: string;
  solutionArchitect?: string;
  description: string;
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

export function useUpdateTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateTaskInput }) =>
      apiRequest<Task>(`/tasks/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.projectTasks(projectId) });
      const prev = qc.getQueryData<Task[]>(queryKeys.projectTasks(projectId));
      if (prev) {
        // Mirror the server's rule (backend/src/routes/tasks.ts): a patch only
        // re-orders when it sets an explicit position or moves the task to a
        // different sibling list. A status-only change on a subtask does NOT
        // reorder — its sibling list is keyed on parentTaskId alone — so it
        // must fall through to a plain field merge, not reorderTasksLocally
        // (which would re-append the row to the end of its list).
        const current = prev.find((t) => t.id === id);
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
          : prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Task) : t));
        qc.setQueryData<Task[]>(queryKeys.projectTasks(projectId), next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev)
        qc.setQueryData(queryKeys.projectTasks(projectId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      // The Daily Review page's attention lists let a TAM change a task's
      // status inline (daily-review-v2-spec.md §6.3) — keep that cache in
      // sync too.
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
    },
  });
}

export function useDeleteTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      // Same rationale as useUpdateTask above — a deleted task can drop out
      // of the Daily Review page's overdue-tasks attention list.
      qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot });
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
}

export function useCreateTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiRequest<Task>(`/projects/${projectId}/tasks`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.overview });
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
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        qc.invalidateQueries({ queryKey: ["tasks"] }),
        qc.invalidateQueries({ queryKey: queryKeys.overview }),
        // Same rationale as useUpdateTask/useDeleteTask above — a duplicated
        // task can newly appear in the Daily Review page's attention lists.
        qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot }),
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
  return useQuery({
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
        qc.invalidateQueries({ queryKey: queryKeys.dailyReviewRoot }),
      ]),
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

export function useAddComment(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      apiRequest<Comment>(`/tasks/${taskId}/comments`, {
        method: "POST",
        body: { body },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.comments(taskId) });
    },
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
  projectsAsSA: number;
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
  saId: number | null;
  tamId: number;
  customerId: number | null;
  createdAt: string;
  updatedAt: string;
  sa: { id: number; username: string } | null;
  tam: { id: number; username: string };
  customer: { id: number; name: string } | null;
  _count: { tasks: number };
}

export const adminQueryKeys = {
  users: ["admin", "users"] as const,
  projects: ["admin", "projects"] as const,
  roles: ["admin", "roles"] as const,
  authSettings: ["admin", "settings", "auth"] as const,
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
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiRequest<void>("/auth/change-password", { method: "POST", body: input }),
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
  return useQuery({
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

// ─────────────────────────────────────────────────────────────────────────
// Pipeline (Solution Architect) — Opportunity CRUD, activities, links, and
// the board's stage-move mutation. Mirrors backend/src/routes/opportunities.ts
// and routes/opportunityItems.ts verbatim (docs/plans/pipeline-native-port-plan.md).
// Own key namespace (`pipelineKeys`) — separate from `queryKeys`/`adminQueryKeys`
// per frontend/CLAUDE.md.
// ─────────────────────────────────────────────────────────────────────────

export interface OpportunityPic {
  id: number;
  username: string;
  avatarUrl: string | null;
}

export interface Opportunity {
  id: string;
  title: string;
  customerName: string;
  dealValue: number;
  stage: PipelineStage;
  picId: number | null;
  pic: OpportunityPic | null;
  // Plain calendar day ("yyyy-MM-dd"), never an ISO instant — same DateField
  // contract as Task.startDate/dueDate. See backend's dayStringSchema.
  deadline: string | null;
  requestDate: string | null;
  description: string | null;
  productSolution: string;
  leadSource: string | null;
  winProbability: number;
  stageOrder: number;
  wonAt: string | null;
  preHoldStage: PipelineStage | null;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityActivity {
  id: string;
  opportunityId: string;
  userId: number | null;
  user: OpportunityPic | null;
  note: string;
  createdAt: string;
}

export interface OpportunityLink {
  id: string;
  opportunityId: string;
  label: string;
  url: string;
  createdAt: string;
}

export const pipelineKeys = {
  // The deliberate invalidate-EVERYTHING-pipeline-related root — every other
  // key below is a literal array-prefix extension of this one, so
  // `invalidateQueries({ queryKey: pipelineKeys.root })` (TanStack's default
  // prefix match) hits the list, every detail/activities/links query, and
  // the import log all at once. Kept as its own key (review finding N1/N2)
  // rather than reusing `list` for this — `list` used to BE this array
  // verbatim, which meant every mutation that invalidated "just the list"
  // was silently invalidating the entire pipeline cache by prefix-match
  // accident, not by design. Nothing currently needs the everything-at-once
  // hammer (each mutation below invalidates precisely what it touches), but
  // it stays available/documented for a future case that does.
  root: ["pipeline", "opportunities"] as const,
  list: ["pipeline", "opportunities", "list"] as const,
  detail: (id: string) => ["pipeline", "opportunities", id] as const,
  activities: (id: string) => ["pipeline", "opportunities", id, "activities"] as const,
  links: (id: string) => ["pipeline", "opportunities", id, "links"] as const,
  imports: ["pipeline", "opportunities", "imports"] as const,
};

export function useOpportunities() {
  return useQuery({
    queryKey: pipelineKeys.list,
    queryFn: ({ signal }) => apiRequest<Opportunity[]>("/opportunities", { signal }),
  });
}

export function useOpportunity(id: string | null) {
  return useQuery({
    queryKey: id ? pipelineKeys.detail(id) : ["pipeline", "opportunities", "noop"],
    queryFn: ({ signal }) => apiRequest<Opportunity>(`/opportunities/${id}`, { signal }),
    enabled: id !== null,
  });
}

export function useOpportunityActivities(id: string | null) {
  return useQuery({
    queryKey: id
      ? pipelineKeys.activities(id)
      : ["pipeline", "opportunities", "noop", "activities"],
    queryFn: ({ signal }) =>
      apiRequest<OpportunityActivity[]>(`/opportunities/${id}/activities`, { signal }),
    enabled: id !== null,
  });
}

export function useOpportunityLinks(id: string | null) {
  return useQuery({
    queryKey: id ? pipelineKeys.links(id) : ["pipeline", "opportunities", "noop", "links"],
    queryFn: ({ signal }) => apiRequest<OpportunityLink[]>(`/opportunities/${id}/links`, { signal }),
    enabled: id !== null,
  });
}

export interface CreateOpportunityInput {
  title: string;
  customerName: string;
  dealValue?: number;
  picId?: number | null;
  deadline?: string | null;
  requestDate?: string | null;
  description?: string | null;
  productSolution?: string;
  leadSource?: string | null;
  winProbability?: number;
  // Create-only — the backend's PATCH schema rejects `stage` (400): stage
  // transitions after creation go through POST /:id/move only.
  stage?: PipelineStage;
}

export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOpportunityInput) =>
      apiRequest<Opportunity>("/opportunities", { method: "POST", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineKeys.list });
    },
  });
}

export interface UpdateOpportunityInput {
  title?: string;
  customerName?: string;
  dealValue?: number;
  picId?: number | null;
  deadline?: string | null;
  requestDate?: string | null;
  description?: string | null;
  productSolution?: string;
  leadSource?: string | null;
  winProbability?: number;
}

export function useUpdateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateOpportunityInput }) =>
      apiRequest<Opportunity>(`/opportunities/${id}`, { method: "PATCH", body: patch }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: pipelineKeys.list });
      qc.invalidateQueries({ queryKey: pipelineKeys.detail(updated.id) });
    },
  });
}

// One writer of a PIC on an unassigned deal for `pipeline:edit_own` holders
// (the PATCH route keeps refusing an unassigned deal for them — see
// POST /opportunities/:id/assign in backend/src/routes/opportunities.ts).
// Not optimistic: this is a dialog submit (AssignPicModal), not an
// inline-edit field, so there's no local value to write ahead of the
// response. The route writes an "Assigned to <username>" activity note in
// the same transaction, but only when the PIC actually changes (D6).
// `activities(id)` is already a prefix-match of `detail(id)`, so its
// invalidation below is explicit rather than load-bearing — same
// enumerate-every-key convention as useDeleteOpportunity/useMoveOpportunity.
export function useAssignOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, picId }: { id: string; picId: number }) =>
      apiRequest<Opportunity>(`/opportunities/${id}/assign`, { method: "POST", body: { picId } }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: pipelineKeys.list });
      qc.invalidateQueries({ queryKey: pipelineKeys.detail(updated.id) });
      qc.invalidateQueries({ queryKey: pipelineKeys.activities(updated.id) });
    },
  });
}

export function useDeleteOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/opportunities/${id}`, { method: "DELETE" }),
    // Explicit per-resource invalidation (list + this id's own detail/
    // activities/links), not just the list — since the N1/N2 key-hygiene
    // fix above, `pipelineKeys.list` is a sibling of those keys, not a
    // shared prefix, so it no longer catches them by accident. Without this,
    // a stale cached detail/activities/links entry for the just-deleted id
    // could still be served (e.g. on a browser-back navigation) until it
    // aged out of the cache on its own.
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: pipelineKeys.list });
      qc.invalidateQueries({ queryKey: pipelineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: pipelineKeys.activities(id) });
      qc.invalidateQueries({ queryKey: pipelineKeys.links(id) });
    },
  });
}

export function useAddOpportunityActivity(opportunityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note: string) =>
      apiRequest<OpportunityActivity>(`/opportunities/${opportunityId}/activities`, {
        method: "POST",
        body: { note },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineKeys.activities(opportunityId) });
    },
  });
}

export interface CreateOpportunityLinkInput {
  label: string;
  url: string;
}

export function useAddOpportunityLink(opportunityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOpportunityLinkInput) =>
      apiRequest<OpportunityLink>(`/opportunities/${opportunityId}/links`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineKeys.links(opportunityId) });
    },
  });
}

export type UpdateOpportunityLinkInput = Partial<CreateOpportunityLinkInput>;

export function useUpdateOpportunityLink(opportunityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateOpportunityLinkInput }) =>
      apiRequest<OpportunityLink>(`/opportunities/${opportunityId}/links/${id}`, {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineKeys.links(opportunityId) });
    },
  });
}

export function useDeleteOpportunityLink(opportunityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/opportunities/${opportunityId}/links/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineKeys.links(opportunityId) });
    },
  });
}

export interface MoveOpportunityInput {
  id: string;
  stage: PipelineStage;
  stageOrder: number;
}

/**
 * Reorders/re-stages `id` inside a locally-cached opportunity list exactly
 * the way the backend's insertAtStage/closeGapInStage do (see
 * backend/src/routes/opportunities.ts's POST /:id/move): remove `id` from
 * its current stage's sibling list (re-packing it to dense 0..n-1), then
 * insert it into the target stage's sibling list at the clamped requested
 * index (re-packing that too). Mirrors reorderTasksLocally above, scoped to
 * `stage` instead of (parentTaskId, status). Returns a new array; doesn't
 * mutate `opportunities`.
 */
export function reorderOpportunitiesLocally(
  opportunities: Opportunity[],
  id: string,
  stage: PipelineStage,
  stageOrder: number,
): Opportunity[] {
  const current = opportunities.find((o) => o.id === id);
  if (!current) return opportunities;

  // Every other opportunity, grouped by which stage it's currently in.
  const byStage = new Map<PipelineStage, Opportunity[]>();
  for (const o of opportunities) {
    if (o.id === id) continue;
    const arr = byStage.get(o.stage) ?? [];
    arr.push(o);
    byStage.set(o.stage, arr);
  }
  // Codepoint compare, not `localeCompare` (finding N1): matches
  // `compareDealsByStageOrder`'s tiebreak (components/pipeline/adapter.ts)
  // and Postgres's byte-order `uuid` comparison the server's own
  // `stageSiblingIds` query relies on (`ORDER BY ... id ASC`,
  // backend/src/routes/opportunities.ts) — `localeCompare` can disagree
  // with both for some id pairs under locale-aware collation.
  for (const arr of byStage.values()) {
    arr.sort((a, b) => a.stageOrder - b.stageOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const updated: Opportunity = { ...current, stage, stageOrder };

  const targetSiblings = [...(byStage.get(stage) ?? [])];
  const clamped = Math.max(0, Math.min(stageOrder, targetSiblings.length));
  targetSiblings.splice(clamped, 0, updated);

  // Re-pack stageOrder for both the target stage (insertion applied) and,
  // when the deal changed stages, the source stage (gap closed). If
  // source === target, targetSiblings already covers it.
  const repacked = new Map<string, number>();
  targetSiblings.forEach((o, i) => repacked.set(o.id, i));
  if (current.stage !== stage) {
    (byStage.get(current.stage) ?? []).forEach((o, i) => repacked.set(o.id, i));
  }

  return opportunities.map((o) => {
    if (o.id === id)
      return { ...updated, stageOrder: repacked.get(id) ?? updated.stageOrder };
    if (repacked.has(o.id)) return { ...o, stageOrder: repacked.get(o.id)! };
    return o;
  });
}

// The board drag mutation. Optimistic per the house pattern (see
// useUpdateTask above): onMutate cancels + snapshots the list and
// optimistically rewrites the moved deal's stage/stageOrder (and resequences
// stage-siblings the same dense way the server does) — on a REAL stage
// change (not a same-stage reorder), it also mirrors the server's
// wonAt/preHoldStage bookkeeping (POST /:id/move in
// backend/src/routes/opportunities.ts, finding N3) so the optimistic write
// doesn't visibly diverge from the eventual server response for the moment
// between commit and invalidation. onError rolls back,
// onSettled invalidates the list so the server's authoritative order lands.
export function useMoveOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage, stageOrder }: MoveOpportunityInput) =>
      apiRequest<Opportunity>(`/opportunities/${id}/move`, {
        method: "POST",
        body: { stage, stageOrder },
      }),
    onMutate: async ({ id, stage, stageOrder }) => {
      await qc.cancelQueries({ queryKey: pipelineKeys.list });
      const prev = qc.getQueryData<Opportunity[]>(pipelineKeys.list);
      if (prev) {
        const current = prev.find((o) => o.id === id);
        const reordered = reorderOpportunitiesLocally(prev, id, stage, stageOrder);
        // Bookkeeping mirror of the server's own POST /:id/move transaction
        // (backend/src/routes/opportunities.ts, finding N3) — deliberately
        // done HERE, in the caller, rather than inside
        // reorderOpportunitiesLocally itself: that function stays a pure
        // repositioning helper (ordering only), while wonAt/preHoldStage are
        // a business-rule side effect of a REAL stage transition, keyed off
        // `current`'s pre-move stage (only known here, before reordering).
        const next =
          current && current.stage !== stage
            ? reordered.map((o) => {
                if (o.id !== id) return o;
                const enteringWon = stage === "WON";
                const leavingWon = current.stage === "WON";
                const enteringHold = stage === "HOLD";
                const leavingHold = current.stage === "HOLD";
                return {
                  ...o,
                  wonAt: enteringWon ? new Date().toISOString() : leavingWon ? null : o.wonAt,
                  preHoldStage: enteringHold ? current.stage : leavingHold ? null : o.preHoldStage,
                };
              })
            : reordered;
        qc.setQueryData<Opportunity[]>(pipelineKeys.list, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(pipelineKeys.list, ctx.prev);
    },
    // Explicitly invalidates this deal's own detail + activities queries,
    // not just the list — and since the N1/N2 key-hygiene fix
    // (`pipelineKeys.list` above), this is no longer redundant with
    // invalidating the list: `list` is a sibling key now, not a shared
    // array-prefix of `detail`/`activities`, so it doesn't catch them by
    // accident the way it used to. A move is reachable from
    // OpportunityDetail's StageMenu (not only the board drag), and the
    // server logs an OpportunityActivity on a real stage change (POST
    // /:id/move, backend/src/routes/opportunities.ts) — without these two
    // explicit calls, a detail-page stage change wouldn't refresh its own
    // wonAt/preHoldStage or activity feed until something else happened to
    // invalidate them.
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: pipelineKeys.list });
      qc.invalidateQueries({ queryKey: pipelineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: pipelineKeys.activities(id) });
    },
  });
}

// Won-deal handoff (PRD §2.10, M5.24) — `POST /opportunities/:id/handoff`.
// Body is the SAME shape as `POST /projects` (`CreateProjectInput` above;
// the backend's own handoff schema actually mirrors plain project
// creation's tamId leniency too — an omitted tamId defaults to the caller
// — but `HandoffProjectModal` (DealCard.tsx) requires an explicit pick
// anyway: the caller completing a handoff is typically the SA, not the
// intended TAM, so that default would misassign ownership more often than
// not. That's a calling-form choice, not re-typed here). The native port
// does the whole
// project-create + `Opportunity.projectId` link in one backend transaction
// (CLAUDE.md's native-port guardrail: no compensating unlink), so there's
// nothing to roll back client-side on failure — this mutation is plain
// (no onMutate optimism), matching useCreateProject's own shape above.
// `project` is `CreatedProject` (finding N5), not `ProjectSummary` — this
// route's own `prisma.project.create` call (backend/src/routes/
// opportunities.ts's POST /:id/handoff) mirrors POST /projects's, with the
// exact same no-`include` shape; see `CreatedProject`'s doc comment above.
export interface HandoffOpportunityResult {
  project: CreatedProject;
  opportunity: Opportunity;
}

export function useHandoffOpportunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiRequest<HandoffOpportunityResult>(`/opportunities/${id}/handoff`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      // `pipelineKeys.root` (not just `list`/`detail(id)`): the deal's
      // `projectId` link is new state every pipeline surface showing this
      // deal should pick up. `["projects"]` is the same prefix-match key
      // `useCreateProject` above invalidates — matches `queryKeys.projects`'s
      // `["projects", filter]` shape by array prefix, catching every
      // customer-filtered projects-list cache entry, not just the
      // unfiltered one.
      qc.invalidateQueries({ queryKey: pipelineKeys.root });
      qc.invalidateQueries({ queryKey: ["projects"] });
      // A handoff is ALSO a project create in every way that matters to
      // these three caches (finding S1) — `useCreateProject` above
      // invalidates all three for the exact same reason (new/changed
      // project membership reshapes Overview's counts, the Customers list's
      // `_count.projects`, and the Executive roll-up), and this mutation
      // creates a project too, via the same backend `prisma.project.create`
      // call. Without these, the new delivery project wouldn't appear on
      // any of those three surfaces until something unrelated happened to
      // invalidate them first.
      qc.invalidateQueries({ queryKey: queryKeys.overview });
      qc.invalidateQueries({ queryKey: queryKeys.customers });
      qc.invalidateQueries({ queryKey: queryKeys.executiveReport() });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline — Excel import (PRD §2.9). `PipelineImportDialog.tsx` parses the
// workbook client-side (SheetJS/`xlsx`, lazy-loaded) and POSTs the parsed
// rows here; the server re-validates and does the actual create/skip work.
// `ImportOpportunityRow` mirrors `importRowSchema` in
// backend/src/routes/opportunities.ts's POST /import field-for-field, plus
// `activityLog`, which seeds the deal's first `OpportunityActivity` note the
// same way Velora's importer does (`../VeloraApp`
// app/api/opportunities/import/route.ts, read-only reference) — Opportunity
// itself has no activity-log column.
// ─────────────────────────────────────────────────────────────────────────

export interface ImportOpportunityRow {
  title: string;
  customerName: string;
  dealValue: number;
  stage: PipelineStage;
  picId?: number | null;
  deadline?: string | null;
  productSolution?: string;
  winProbability?: number;
  leadSource?: string | null;
  activityLog?: string | null;
}

// Per-row outcome in the server's import response — mirrors
// `ImportRowResult` in backend/src/routes/opportunities.ts's POST /import
// verbatim: `row` is the 1-based index within the `rows` array this call
// submitted (not the workbook's row number), `id` is only present when
// `status === "valid"`. The server doesn't echo back title/customerName —
// the dialog cross-references `row` against the rows it submitted to show
// them.
export interface ImportRowResult {
  row: number;
  status: "valid" | "skipped" | "invalid";
  reason?: string;
  id?: string;
}

export interface ImportOpportunitiesResult {
  totalRows: number;
  validCount: number;
  skipCount: number;
  invalidCount: number;
  results: ImportRowResult[];
}

export function useImportOpportunities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: ImportOpportunityRow[]) =>
      apiRequest<ImportOpportunitiesResult>("/opportunities/import", {
        method: "POST",
        body: { rows },
      }),
    // list (new opportunities land on the board) + imports (the admin
    // Pipeline tab's import-history log, `usePipelineImports()`, gets a new
    // row every call) — both explicit since the N1/N2 key-hygiene fix:
    // `pipelineKeys.list` no longer shares an array-prefix with
    // `pipelineKeys.imports`, so invalidating just the list would silently
    // stop refreshing the import log after every import.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineKeys.list });
      qc.invalidateQueries({ queryKey: pipelineKeys.imports });
    },
  });
}

// Import admin surface (PRD §2.9/M4.19's "Pipeline" admin tab — Import
// history). Mirrors GET /opportunities/imports (backend/src/routes/
// opportunities.ts) verbatim — `user` is the same `PIC_SELECT` projection
// as `Opportunity.pic`, so it reuses `OpportunityPic`. `status` mirrors the
// Prisma `PipelineImportStatus` enum (schema.prisma): "OK" | "ERROR".
export interface PipelineImportLogEntry {
  id: string;
  user: OpportunityPic | null;
  totalRows: number;
  validCount: number;
  skipCount: number;
  invalidCount: number;
  status: "OK" | "ERROR";
  errorMessage: string | null;
  createdAt: string;
}

export function usePipelineImports() {
  return useQuery({
    queryKey: pipelineKeys.imports,
    queryFn: ({ signal }) =>
      apiRequest<PipelineImportLogEntry[]>("/opportunities/imports", { signal }),
  });
}
