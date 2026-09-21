// Ported from the QA gate script (qa-fixtures.mjs): seeds a fresh project
// (with a handful of tasks/subtasks) via the API so specs never depend on
// pre-existing data beyond the admin account created in CI /locally.
//
// Login uses the "sa" (service area) id from the login response itself
// (user.id) rather than a hardcoded id — the QA script's `saId: 1` only
// worked because the admin happened to be user #1; using the caller's own
// id is correct regardless of seeding order.

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "qa@solvro.test";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "QaTest1234!";

/**
 * yyyy-MM-dd for `offsetDays` from today (or from `from`, for chaining an
 * offset off another offset). Plan B Task 8 finding: the ReUI-engined Gantt
 * (SolvroGantt.tsx) anchors its initial visible window on `new Date()` (no
 * `defaultDate` is passed to `<Gantt>`) and does NOT expand that window to
 * fit the project's actual task dates on mount — a task dated outside the
 * ~1-week default window simply isn't in the DOM until the user manually
 * scrolls (confirmed via manual investigation: reaching a task 24 days in
 * the past took 40 wheel-scroll steps). The OLD engine derived its chart
 * window from the tasks' own min/max dates, so this is a real regression,
 * reported separately (see task-b8-report.md) — this helper is the
 * independent fix for a latent fixture fragility the regression exposed:
 * hardcoded absolute dates (e.g. "2026-07-01") drift out of any
 * "near-today" rendering window as wall-clock time advances past them.
 * Every seeded/spec-created task date should be relative to today so the
 * suite stays deterministic regardless of which day it actually runs.
 */
export function isoDateOffset(offsetDays: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export interface SeededTask {
  id: number;
  title: string;
  status: string;
  position: number;
  parentTaskId: number | null;
  [key: string]: unknown;
}

export interface SeededFixture {
  token: string;
  userId: number;
  projectId: number;
  // T10 stabilization: the seeded project's customer id, exposed so specs
  // can scope `/tasks` page queries (`TasksFilter.customerId`) to just this
  // fixture's rows. Unscoped `GET /tasks` windows to `take: 200` globally
  // ordered rows (backend/src/routes/tasks.ts) — on a dev DB that has
  // accumulated thousands of tasks across every prior e2e/QA run, this
  // fixture's own rows can fall entirely outside that window, and the
  // `/tasks` page renders zero matching `<tr>`s.
  customerId: number;
  // The customer's display name — the Tasks/Projects filter is a ReUI
  // Filters chip flow since 2026-07-31, and its option list is driven by
  // names, not ids, so UI-side scoping needs this alongside customerId.
  customerName: string;
  alpha: SeededTask;
  beta: SeededTask;
  gamma: SeededTask;
  delta: SeededTask;
  subA: SeededTask;
  subB: SeededTask;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function login(
  base: string,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<{ token: string; userId: number }> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await json<{ token: string; user: { id: number } }>(res);
  return { token: data.token, userId: data.user.id };
}

/** Seeds a fresh customer + project + tasks/subtasks. */
export async function seedFixture(base: string): Promise<SeededFixture> {
  const { token, userId } = await login(base);
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // T10 stabilization finding: this used to reuse `customers[0]` (GET
  // /customers, ordered alphabetically by name) whenever any customer
  // existed, to avoid growing the customers table across repeated suite
  // runs. In practice that meant every seedFixture call across this repo's
  // entire e2e/QA history has kept attaching fresh projects to whichever
  // customer sorts first by name (empirically "Acme Corp", id 1) — which has
  // accumulated 380+ projects as a result. That pollution is exactly why
  // customer-scoped queries can't be trusted to surface a freshly seeded
  // project's own rows: `GET /tasks?customerId=1` alone still returns enough
  // OTHER (older, lower-id, same-position) rows from Acme Corp's other
  // projects to fill the backend's `take: 200` window before this run's own
  // tasks are reached (confirmed empirically against the dev DB). Always
  // creating an isolated, single-project customer per fixture call is what
  // makes `TasksFilter.customerId` scoping actually work as an isolation
  // boundary rather than compounding the same shared-customer pollution.
  const customerName = `QA Fixture Co ${stamp}`;
  const c = await fetch(`${base}/api/customers`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: customerName, description: "e2e fixture" }),
  }).then((r) => json<{ id: number }>(r));
  const custId = c.id;

  const proj = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: `Gate ${stamp}`,
      description: "e2e fixture project",
      customerId: custId,
      saId: userId,
    }),
  }).then((r) => json<{ id: number }>(r));

  const mk = (body: Record<string, unknown>) =>
    fetch(`${base}/api/projects/${proj.id}/tasks`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    }).then((r) => json<SeededTask>(r));

  // Relative to today (isoDateOffset, above) — NOT hardcoded calendar dates.
  // Same relative offsets/durations as the original fixed dates (alpha
  // 0→+4, beta +1→+7, gamma +2→+8, delta 0→+11), just re-anchored so the
  // seeded tasks stay near "today" no matter when the suite runs — see
  // isoDateOffset's doc comment for why that now matters against the
  // ReUI-engined Gantt.
  const alpha = await mk({ title: "Alpha", status: "TODO", startDate: isoDateOffset(0), dueDate: isoDateOffset(4) });
  const beta = await mk({ title: "Beta", status: "TODO", startDate: isoDateOffset(1), dueDate: isoDateOffset(7) });
  const gamma = await mk({ title: "Gamma", status: "TODO", startDate: isoDateOffset(2), dueDate: isoDateOffset(8) });
  const delta = await mk({ title: "Delta", status: "IN_PROGRESS", startDate: isoDateOffset(0), dueDate: isoDateOffset(11) });
  const subA = await mk({ title: "Sub one", parentTaskId: alpha.id });
  const subB = await mk({ title: "Sub two", parentTaskId: alpha.id });

  return { token, userId, projectId: proj.id, customerId: custId, customerName, alpha, beta, gamma, delta, subA, subB };
}

export interface CreateTaskInput {
  title: string;
  parentTaskId?: number | null;
  sectionId?: number | null;
  status?: string;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
  isCriticalPath?: boolean;
}

/**
 * Creates one extra task in an already-seeded project. Specs that need their
 * own throwaway rows (rather than mutating the shared fixture's
 * alpha/beta/gamma/delta) use this instead of hand-rolling the same POST —
 * date-picker.spec.ts and gantt-parity.spec.ts each still carry a private copy
 * that predates this helper and can fold into it independently.
 */
export async function createTask(
  base: string,
  token: string,
  projectId: number,
  input: CreateTaskInput,
): Promise<SeededTask> {
  const res = await fetch(`${base}/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return json<SeededTask>(res);
}

export async function getTasks(base: string, token: string, projectId: number): Promise<SeededTask[]> {
  const res = await fetch(`${base}/api/projects/${projectId}/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return json<SeededTask[]>(res);
}

export interface CreateSectionInput {
  name: string;
  position?: number;
  color?: string;
}

export interface SeededSection {
  id: number;
  projectId: number;
  name: string;
  position: number;
  color: string;
  createdAt: string;
}

/**
 * Creates a section in an already-seeded project (POST /projects/:id/sections).
 * `gantt-parity.spec.ts` and `gantt-legend.spec.ts` each carry their own
 * private, narrower copy (name-only, predate this helper) — new specs
 * needing a section use this one instead.
 */
export async function createSection(
  base: string,
  token: string,
  projectId: number,
  input: CreateSectionInput,
): Promise<SeededSection> {
  const res = await fetch(`${base}/api/projects/${projectId}/sections`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return json<SeededSection>(res);
}

export async function setWipLimits(
  base: string,
  token: string,
  projectId: number,
  wipLimits: Record<string, number | null>,
): Promise<void> {
  await fetch(`${base}/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ wipLimits }),
  });
}
