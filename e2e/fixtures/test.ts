import { expect, test as base, type Page, type Request, type TestInfo } from "@playwright/test";
import { seedFixture, type SeededFixture } from "./seed";

// Worker-scoped fixture: one seeded project per worker. playwright.config.ts
// pins workers: 1, so the whole run (every spec file) shares ONE project and
// earlier specs leave their tasks behind for later ones. Specs must derive
// state from the API rather than assume a clean project, and should seed their
// own rows instead of relying on the project being empty. (CI shards each get
// a fresh stack, so a spec must not depend on another spec file's data.)
interface WorkerFixtures {
  seededProject: SeededFixture;
}

export const test = base.extend<{}, WorkerFixtures>({
  seededProject: [
    async ({}, use, workerInfo) => {
      const base = workerInfo.project.use.baseURL ?? "http://localhost:8080";
      const fixture = await seedFixture(base);
      await use(fixture);
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";

/** The configured baseURL for the running project (desktop/mobile), origin only. */
export function apiBase(testInfo: TestInfo): string {
  return new URL(testInfo.project.use.baseURL ?? "http://localhost:8080").origin;
}

/**
 * Whether the stack under test offers Google sign-in (the same public
 * endpoint the Login page reads). The seeded QA stack does not; a dev stack
 * with a client ID and allowed domains does, and then the login page shows
 * the Google button and collapses the password form behind an accordion.
 */
export async function googleSignInEnabled(testInfo: TestInfo): Promise<boolean> {
  const res = await fetch(`${apiBase(testInfo)}/api/auth/google/config`);
  if (!res.ok) throw new Error(`GET /api/auth/google/config failed: ${res.status}`);
  const body = (await res.json()) as { enabled?: boolean; clientId?: string | null };
  // Same condition as Login.tsx's googleAvailable.
  return Boolean(body.enabled && body.clientId);
}

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "qa@solvro.test";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "QaTest1234!";

/**
 * Logs in through the UI. When Google sign-in is configured, the password
 * form lives behind the "Admin sign-in (password)" accordion and must be
 * expanded first; when Google sign-in is NOT configured (the default for
 * the seeded QA stack — no clientId/allowed domains), Login renders the
 * password form directly with no accordion, so there's nothing to click.
 */
export async function loginViaUi(
  page: Page,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await submitLoginForm(page, email, password);
  await page.waitForURL(/overview|projects|\/$/i, { timeout: 10_000 }).catch(() => {});
  // The "/" in the URL pattern matches the login page itself, so the real
  // sign-in signal is the stored token the next navigation reads.
  await page.waitForFunction(() => !!localStorage.getItem("solvro.token"), undefined, {
    timeout: 15_000,
  });
}

/** Resolves after `n` animation frames: lets handlers queued by the last input
 * event run and paint, replacing a fixed sleep after a click or pointer move. */
export async function nextFrames(page: Page, n = 2): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, n);
}

/** Resolves once no finite CSS/Web animation is running (drawer slide, layout
 * reflow); infinite ones, such as spinners, are ignored. A transition can start
 * a frame or more after the render that causes it, so this waits two frames
 * first and only stops after a full frame in which nothing finite was running.
 * Capped, so a page that animates forever cannot hang it. */
export async function settleAnimations(page: Page): Promise<void> {
  await nextFrames(page, 2);
  await page.evaluate(async () => {
    const running = () =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    for (let i = 0; i < 40; i++) {
      const current = running();
      if (current.length === 0) {
        await frame();
        if (running().length === 0) return;
        continue;
      }
      await Promise.all(current.map((a) => a.finished.catch(() => undefined)));
      await frame();
    }
  });
}

/** For asserting that something did NOT happen (a second request, a redirect).
 * Playwright's `networkidle` fires once per document and never again after
 * in-app requests, so this listens to requests itself: it returns once no
 * `/api/` request has been in flight or started for `quietMs`, restarting that
 * window on every new request, within an overall cap. The quiet window is
 * deliberate: there is no event for "nothing else is coming", so the absence
 * check is only as strong as this window. Pass a larger `quietMs` when the app
 * delays the thing being ruled out. */
export async function settleQuiet(page: Page, quietMs = 500, capMs = 15_000): Promise<void> {
  const inflight = new Set<Request>();
  let lastActivity = Date.now();
  const onRequest = (req: Request) => {
    if (req.url().includes("/api/")) {
      inflight.add(req);
      lastActivity = Date.now();
    }
  };
  const onDone = (req: Request) => {
    if (inflight.delete(req)) lastActivity = Date.now();
  };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  try {
    await nextFrames(page, 5);
    const start = Date.now();
    while (Date.now() - start < capMs) {
      if (inflight.size === 0 && Date.now() - lastActivity >= quietMs) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
  }
}

/** Counts in-flight `/api/` requests from the moment it is created. `settled()`
 * waits for the requests an input started (a drag's PATCH and the refetch after
 * it) to finish, then for animations, so a spec can read the result without a
 * fixed sleep. Call `dispose()` when done. */
export function trackApiRequests(page: Page): { settled: () => Promise<void>; dispose: () => void } {
  const inflight = new Set<Request>();
  const isApi = (req: Request) => req.url().includes("/api/");
  const onRequest = (req: Request) => {
    if (isApi(req)) inflight.add(req);
  };
  const onDone = (req: Request) => {
    inflight.delete(req);
  };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  return {
    settled: async () => {
      // Two frames let the pointerup handler start its mutation; a refetch can
      // start right after a mutation ends, so re-check after one more frame.
      await nextFrames(page, 2);
      for (let round = 0; round < 3; round++) {
        await expect.poll(() => inflight.size, { timeout: 15_000 }).toBe(0);
        await nextFrames(page, 2);
        if (inflight.size === 0) break;
      }
      // Still busy after the re-checks: fail here instead of reading mid-flight.
      await expect.poll(() => inflight.size, { timeout: 15_000 }).toBe(0);
      await settleAnimations(page);
    },
    dispose: () => {
      page.off("request", onRequest);
      page.off("requestfinished", onDone);
      page.off("requestfailed", onDone);
    },
  };
}

/** Waits until the Gantt's tree and timeline panes are rendered. */
export async function waitForGanttReady(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="gantt-tree-pane"]')).toBeVisible();
  await expect(page.locator('[data-slot="gantt-timeline-pane"]')).toBeVisible();
}

/**
 * Fills and submits the login form on the page that is already showing it
 * (expanding the "Admin sign-in" accordion first when Google sign-in is
 * configured). Use when the test itself navigated to /login — e.g. via the
 * auth guard's redirect — and needs to assert where sign-in lands.
 */
export async function submitLoginForm(
  page: Page,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<void> {
  // The form is not there yet while the sign-in config loads, so wait for
  // whichever of the two layouts shows up instead of probing once.
  const emailField = page.locator('input[type="email"]');
  const accordion = page.locator("summary").filter({ hasText: /Admin sign-in/i });
  await emailField.or(accordion).first().waitFor({ state: "visible", timeout: 15_000 });
  if (await accordion.isVisible()) {
    await accordion.click();
  }
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: "visible" });
  await emailInput.fill(email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

/**
 * Route segment for the Kanban board under test — the ReUI-engine board,
 * cut over to the real `/kanban` route at
 * `docs/archive/plans/kanban-reui-swap/plan.md` T11. Single source of truth so specs
 * don't hardcode the segment.
 */
export const KANBAN_ROUTE = "kanban";

/** Opens TaskFormModal in edit mode for one task, from its Gantt row menu (Edit).
 * A /tasks row opens the task's page, which has no Parent field and no
 * TaskFormModal, so the Gantt is the one place left that mounts the form for
 * any task. Desktop only, like the Gantt itself. Waits for the title input to
 * hold the task and focus. */
export async function openTaskEditModal(page: Page, projectId: number, taskId: number, title: string): Promise<void> {
  await page.goto(`/projects/${projectId}/gantt`, { waitUntil: "networkidle" });
  await waitForGanttReady(page);
  const row = page.locator(`[data-slot="gantt-row-group"][data-gantt-row-id="task-${taskId}"]`);
  await expect(row, `expected a Gantt row for task ${taskId}`).toBeVisible();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const titleInput = page.getByPlaceholder("Task title");
  await expect(titleInput).toHaveValue(title);
  await expect(titleInput).toBeFocused();
}

export async function openKanban(page: Page, projectId: number): Promise<void> {
  await page.goto(`/projects/${projectId}/${KANBAN_ROUTE}`, { waitUntil: "networkidle" });
  await expect(page.locator('[data-slot="kanban-item"]').first()).toBeVisible();
}

export interface CapturedTaskRequest {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * Captures every PATCH/POST request to `/api/tasks*` fired while `fn` runs —
 * the shared request-absence AND body-capture tool (scenarios.md's G3-G6,
 * G9c: no-op guards need to assert zero requests; empty-column/filtered
 * appends need to inspect the actual body, since API-readback alone can't
 * distinguish "no `position` key sent" from "a `position` was sent and
 * happened to compute the same value"). The listener is attached BEFORE
 * `fn` runs and detached after a short settle window (mutations fire
 * async, after the gesture's mouse/touch events resolve), so callers can
 * assert either `.length === 0` or inspect `.body` on what was captured.
 */
export async function captureTaskRequests(
  page: Page,
  fn: () => Promise<void>,
): Promise<CapturedTaskRequest[]> {
  const requests: CapturedTaskRequest[] = [];
  const onRequest = (req: Request) => {
    const method = req.method();
    if (method !== "PATCH" && method !== "POST") return;
    const url = req.url();
    if (!url.includes("/api/tasks")) return;
    let body: Record<string, unknown> | null = null;
    try {
      body = req.postDataJSON() as Record<string, unknown>;
    } catch {
      body = null;
    }
    requests.push({ method, url, body });
  };
  page.on("request", onRequest);
  const tracker = trackApiRequests(page);
  try {
    await fn();
    await tracker.settled();
  } finally {
    tracker.dispose();
    page.off("request", onRequest);
  }
  return requests;
}

/** Locates the drag grip belonging to the element containing `text`: the grip
 * whose center is nearest (and left of / above) the text's center. Ported
 * verbatim from the QA gate script's `gripFor` heuristic. */
export async function gripFor(page: Page, text: string, gripLabel: string) {
  const target = page.getByText(text, { exact: true }).first();
  const tb = await target.boundingBox();
  if (!tb) return null;
  // Card grips are named "<gripLabel> <text>" ("Move Alpha"); list grips are the bare label.
  const q = (v: string) => v.replace(/"/g, '\\"');
  const grips = page.locator(`[aria-label="${q(gripLabel)}"], [aria-label="${q(`${gripLabel} ${text}`)}"]`);
  const n = await grips.count();
  let best: { x: number; y: number; width: number; height: number } | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const gb = await grips.nth(i).boundingBox();
    if (!gb) continue;
    const d = Math.abs(gb.y + gb.height / 2 - (tb.y + tb.height / 2)) + Math.abs(gb.x - tb.x) / 10;
    if (d < bestDist) {
      bestDist = d;
      best = gb;
    }
  }
  return best;
}

export function center(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Mouse-based drag with interpolated moves (desktop / dnd-kit PointerSensor). */
export async function mouseDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const tracker = trackApiRequests(page);
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14);
      // One frame per step: dnd-kit measures and re-renders on each move.
      await nextFrames(page, 1);
    }
    await nextFrames(page, 3);
    await page.mouse.up();
    await tracker.settled();
  } finally {
    tracker.dispose();
  }
}

/** Touch-based drag via CDP, respecting dnd-kit's TouchSensor 250ms activation
 * delay — the QA smoke script's touch-drag test predates this and is stale;
 * this is the corrected version reused across kanban-dnd + smoke specs. */
export async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const dispatch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
    });

  const tracker = trackApiRequests(page);
  try {
    await dispatch("touchStart", from.x, from.y);
    // Kept: dnd-kit's TouchSensor activates only after a 250ms press, and no DOM
    // state changes until it does, so there is nothing to wait on but the clock.
    await page.waitForTimeout(400);
    for (let i = 1; i <= 12; i++) {
      await dispatch("touchMove", from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
      await nextFrames(page, 2);
    }
    await dispatch("touchEnd", 0, 0);
    await tracker.settled();
  } finally {
    tracker.dispose();
  }
}

/** The customer page shows the Tickets tab only for a customer mapped to an
 * iTop organisation (`itopOrgId`, CustomerDetail.tsx). The seeded customer is
 * not mapped, so the customer read is patched with a mapping. */
export async function mockCustomerOrgMapping(page: Page): Promise<void> {
  await page.route("**/api/customers/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, itopOrgId: 4242, itopOrgName: "Northwind Freight Sdn Bhd" },
    });
  });
}
