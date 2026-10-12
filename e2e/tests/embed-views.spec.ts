import type { Page } from "@playwright/test";
import { apiBase, expect, test } from "../fixtures/test";
import {
  createEpic,
  createSection,
  createTask,
  isoDateOffset,
  login,
  seedFixture,
  type SeededFixture,
} from "../fixtures/seed";

// Outline embed views (docs/archive/plans/outline-integration.md, Phase C2):
// /embed/projects/:id/{tasks,status,timeline} render outside the app shell, are
// read-only, and every way out is a link that opens Solvro in a new tab. Signed
// out they show a "Sign in to Solvro" card (never the login form); a viewer who
// cannot see the project gets the no-access card.
//
// Framing headers are the nginx stack's job (frame-headers.spec.ts) — these run
// against the dev server too, where the page is simply opened directly.
//
// Serialize with other Playwright users of this stack:
//   flock /tmp/solvro-e2e.lock npx playwright test tests/embed-views.spec.ts

// The CI stack serves the built app, whose PWA service worker would answer
// the mocked /api fetches itself and bypass page.route (same as the iTop specs).
test.use({ serviceWorkers: "block" });

const PASSWORD = "EmbedViews1234!";

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/** Signs the page in the way the app does: the session token in localStorage. */
async function withSession(page: Page, token: string | null): Promise<void> {
  await page.addInitScript((t) => {
    if (t) localStorage.setItem("solvro.token", t);
    else localStorage.removeItem("solvro.token");
  }, token);
}

/** "Embed in Outline" exists only once an administrator has set an Outline address. */
async function withOutlineAddress(page: Page, baseUrl: string | null = "https://docs.example.test"): Promise<void> {
  await page.route("**/api/outline/config", (route) => route.fulfill({ status: 200, json: { baseUrl } }));
}

interface Data {
  fixture: SeededFixture;
  s: string;
  epic: { id: number; title: string };
  epicDone: string;
  epicOpen: string;
  overdue: string;
  phase: string;
  milestone: string;
}

let data: Data;

test.describe("Outline embed views", () => {
  test.beforeAll(async ({}, testInfo) => {
    const base = apiBase(testInfo);
    const fixture = await seedFixture(base);
    const { token, projectId } = fixture;
    const s = stamp();

    const epic = await createEpic(base, token, projectId, { title: `Launch ${s}` });
    const post = (body: Record<string, unknown>) =>
      fetch(`${base}/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => json<{ id: number }>(r));

    const epicDone = `Epic done ${s}`;
    const epicOpen = `Epic open ${s}`;
    const overdue = `Overdue ${s}`;
    const phase = `Build ${s}`;
    const milestone = `Go-live ${s}`;

    await post({ title: epicDone, epicId: epic.id, status: "DONE", dueDate: isoDateOffset(2) });
    await post({ title: epicOpen, epicId: epic.id, status: "TODO", dueDate: isoDateOffset(9) });
    await createTask(base, token, projectId, {
      title: overdue,
      status: "IN_PROGRESS",
      startDate: isoDateOffset(-10),
      dueDate: isoDateOffset(-3),
    });
    const section = await createSection(base, token, projectId, { name: phase });
    await createTask(base, token, projectId, {
      title: `Phase task ${s}`,
      sectionId: section.id,
      status: "IN_PROGRESS",
      startDate: isoDateOffset(-5),
      dueDate: isoDateOffset(20),
    });
    await createTask(base, token, projectId, {
      title: milestone,
      isMilestone: true,
      sectionId: section.id,
      dueDate: isoDateOffset(25),
    });

    data = { fixture, s, epic: { id: epic.id, title: epic.title }, epicDone, epicOpen, overdue, phase, milestone };
  });

  test("tasks: overdue first, rows open Solvro in a new tab, no app chrome", async ({ page }) => {
    await withSession(page, data.fixture.token);
    await page.goto(`/embed/projects/${data.fixture.projectId}/tasks`);

    await expect(page.getByTestId("embed-title")).toHaveText(/Gate /);
    await expect(page.getByTestId("embed-count")).toHaveText(/^\d+ of \d+ done$/);

    const rows = page.getByTestId("embed-task-row");
    await expect(rows.first()).toContainText(data.overdue);
    // Overdue due date is flagged (error colour hook) and reads as lateness.
    await expect(rows.first().locator("td[data-overdue='true']")).toContainText("3d late");

    const link = rows.first().getByRole("link");
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(`^/projects/${data.fixture.projectId}/list\\?task=\\d+$`),
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    await expect(link.locator(".sr-only")).toHaveText("(opens in a new tab)");

    const footer = page.getByTestId("embed-open");
    await expect(footer).toHaveText(/Open in Solvro to edit/);
    await expect(footer).toHaveAttribute("href", `/projects/${data.fixture.projectId}`);
    await expect(footer).toHaveAttribute("target", "_blank");

    // No sidebar, top bar, install banner or command palette.
    await expect(page.locator("aside, nav")).toHaveCount(0);
    // Every link out of the frame opens a new tab (nothing navigates in place).
    const links = page.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    }
    // Nothing editable.
    await expect(page.locator("input, textarea, select")).toHaveCount(0);

    // Fits the viewport width (desktop and 390 px phone alike).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("tasks: ?limit= truncates and the footer says how many are shown", async ({ page }) => {
    await withSession(page, data.fixture.token);
    await page.goto(`/embed/projects/${data.fixture.projectId}/tasks?limit=2`);
    await expect(page.getByTestId("embed-task-row")).toHaveCount(2);
    await expect(page.getByTestId("embed-showing")).toHaveText(/showing 2 of \d+/);
  });

  test("tasks: ?epic= filters to the epic and names it", async ({ page }) => {
    await withSession(page, data.fixture.token);
    await page.goto(`/embed/projects/${data.fixture.projectId}/tasks?epic=${data.epic.id}`);

    await expect(page.getByTestId("embed-subtitle")).toHaveText(`Epic: ${data.epic.title}`);
    await expect(page.getByTestId("embed-count")).toHaveText("1 of 2 done");
    const rows = page.getByTestId("embed-task-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(data.epicOpen); // open before done
    await expect(rows.nth(1)).toContainText(data.epicDone);
    await expect(page.getByTestId("embed-showing")).toHaveText(/showing 2 of 2/);
    await expect(page.getByText(data.overdue)).toHaveCount(0);
  });

  test("status: progress, health line and next milestone", async ({ page }) => {
    await withSession(page, data.fixture.token);
    await page.goto(`/embed/projects/${data.fixture.projectId}/status`);

    await expect(page.getByTestId("embed-status")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Project progress" })).toBeVisible();
    const health = page.getByTestId("embed-health");
    await expect(health).toContainText(/\d+ overdue/);
    await expect(health).toContainText(/No baseline|On schedule|behind|ahead/);
    await expect(health).toContainText(/\d+ open risks?/);
    await expect(page.getByTestId("embed-milestone")).toContainText(data.milestone);
    await expect(page.getByTestId("embed-open")).toHaveAttribute("target", "_blank");
  });

  test("timeline: read-only phase bars", async ({ page }) => {
    await withSession(page, data.fixture.token);
    await page.goto(`/embed/projects/${data.fixture.projectId}/timeline`);

    const phase = page.getByTestId("embed-phase").filter({ hasText: data.phase });
    await expect(phase).toBeVisible();
    await expect(phase).toContainText("In progress");
    await expect(page.getByTestId("embed-open")).toHaveAttribute("target", "_blank");
    await expect(page.locator("input, textarea, select, button")).toHaveCount(0);
  });

  test("signed out: sign-in card with a new-tab link, never the login form", async ({ page }) => {
    await withSession(page, null);
    const path = `/embed/projects/${data.fixture.projectId}/tasks?epic=${data.epic.id}`;
    await page.goto(path);

    const card = page.getByTestId("embed-signin");
    await expect(card).toContainText("Sign in to Solvro to see this");
    const link = page.getByTestId("embed-signin-link");
    await expect(link).toHaveAttribute("href", `/login?from=${encodeURIComponent(path)}`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(page.getByTestId("embed-reload")).toBeVisible();

    await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(path.split("?")[0]);
  });

  test("signed out: reload picks up a session created in another tab", async ({ page }) => {
    await withSession(page, null);
    await page.goto(`/embed/projects/${data.fixture.projectId}/status`);
    await expect(page.getByTestId("embed-signin")).toBeVisible();

    // Another tab signs in (same storage): the storage event, then a reload.
    await page.evaluate((t) => localStorage.setItem("solvro.token", t), data.fixture.token);
    await page.addInitScript((t) => localStorage.setItem("solvro.token", t), data.fixture.token);
    await page.getByTestId("embed-reload").click();
    await expect(page.getByTestId("embed-status")).toBeVisible();
  });

  test("guest embed: ?embed=1 renders a compact timeline; the plain link is unchanged; a bad link is a compact card", async ({
    page,
    browser,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";
    const created = await json<{ id: number; url: string }>(
      await fetch(`${base}/api/projects/${data.fixture.projectId}/share-links`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.fixture.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "embed e2e", expiresInDays: 7 }),
      }),
    );
    const guestContext = await browser.newContext({ baseURL });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`${created.url}?embed=1`);
      await expect(guest.getByTestId("embed-title")).toHaveText(/Gate /);
      const phase = guest.getByTestId("guest-phase").filter({ hasText: data.phase });
      await expect(phase).toBeVisible();
      await expect(phase).toContainText("In progress");
      await expect(guest.getByTestId("guest-milestone").filter({ hasText: data.milestone })).toBeVisible();
      await expect(guest.getByText(/Shared read-only from Solvro/)).toBeVisible();
      // No page chrome: no header branding block, no Read-only badge, nothing editable or navigable.
      await expect(guest.getByText("Read-only view")).toHaveCount(0);
      await expect(guest.getByTestId("guest-project-name")).toHaveCount(0);
      await expect(guest.locator("header")).toHaveCount(1); // the compact title line only
      await expect(guest.locator("aside, nav, input, textarea, select")).toHaveCount(0);
      await expect(guest.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
      // Compact: no full-page min-height shell.
      const overflow = await guest.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      for (const link of await guest.getByRole("link").all()) {
        await expect(link).toHaveAttribute("target", "_blank");
      }

      // Without ?embed=1 the page is the unchanged full guest view.
      await guest.goto(created.url);
      await expect(guest.getByTestId("guest-project-name")).toBeVisible();
      await expect(guest.getByText("Read-only view")).toBeVisible();
      await expect(guest.getByTestId("embed-root")).toHaveCount(0);

      // An unknown token in embed mode: compact card, no navigation.
      const bad = "/share/" + "x".repeat(43);
      await guest.goto(`${bad}?embed=1`);
      await expect(guest.getByTestId("guest-unavailable")).toContainText(
        "This link has expired or is no longer available",
      );
      await expect(guest.getByTestId("embed-root")).toBeVisible();
      await guest.waitForTimeout(500);
      expect(new URL(guest.url()).pathname).toBe(bad);
      await expect(guest.locator("aside, nav")).toHaveCount(0);

      // Revoked in embed mode: same card.
      const listed = await fetch(`${base}/api/projects/${data.fixture.projectId}/share-links`, {
        headers: { Authorization: `Bearer ${data.fixture.token}` },
      }).then((r) => json<{ id: number; label: string | null }[]>(r));
      const link = listed.find((l) => l.label === "embed e2e");
      expect(link).toBeTruthy();
      const revoked = await fetch(`${base}/api/projects/${data.fixture.projectId}/share-links/${link!.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${data.fixture.token}` },
      });
      expect(revoked.ok).toBe(true);
      await guest.goto(`${created.url}?embed=1`);
      await expect(guest.getByTestId("guest-unavailable")).toBeVisible();
      await expect(guest.getByTestId("embed-root")).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test("embed dialog: views, epic filter, the link that renders, guest audience", async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";
    const origin = new URL(baseURL).origin;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await withSession(page, data.fixture.token);
    await withOutlineAddress(page);
    await page.goto(`/projects/${data.fixture.projectId}/overview`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "More project actions" }).click();
    await page.getByRole("menuitem", { name: "Embed in Outline" }).click();
    const dialog = page.getByRole("dialog", { name: "Embed in Outline" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("embed-domain-note")).toContainText("share a parent domain");

    const url = dialog.getByTestId("embed-link-url");
    const id = data.fixture.projectId;
    // Default: task table, all tasks.
    await expect(url).toHaveValue(`${origin}/embed/projects/${id}/tasks`);

    // Epic filter applies to the task table.
    await dialog.getByLabel("Filter by epic").selectOption({ label: `Epic: ${data.epic.title}` });
    await expect(url).toHaveValue(`${origin}/embed/projects/${id}/tasks?epic=${data.epic.id}`);

    // Other views drop the filter.
    await dialog.getByLabel("Status card").check({ force: true });
    await expect(url).toHaveValue(`${origin}/embed/projects/${id}/status`);
    await expect(dialog.getByLabel("Filter by epic")).toHaveCount(0);
    await dialog.getByLabel("Timeline").check({ force: true });
    await expect(url).toHaveValue(`${origin}/embed/projects/${id}/timeline`);
    await dialog.getByLabel("Task table").check({ force: true });
    await expect(url).toHaveValue(`${origin}/embed/projects/${id}/tasks?epic=${data.epic.id}`);

    // Copy puts exactly the displayed link on the clipboard.
    await dialog.getByTestId("embed-copy").click();
    await expect(dialog.getByTestId("embed-copy")).toContainText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await url.inputValue());

    // The displayed link really renders the embed (filtered to the epic).
    const embedPage = await context.newPage();
    await embedPage.goto(copied);
    await expect(embedPage.getByTestId("embed-subtitle")).toHaveText(`Epic: ${data.epic.title}`);
    await expect(embedPage.getByTestId("embed-task-row")).toHaveCount(2);
    await embedPage.close();

    // Guest audience: timeline only, and nothing is created until asked.
    await dialog.getByLabel("Anyone with the link").check();
    await expect(dialog.getByLabel("Timeline")).toBeChecked();
    await expect(dialog.getByLabel("Task table")).toBeDisabled();
    await expect(dialog.getByLabel("Filter by epic")).toHaveCount(0);
    await expect(url).toHaveCount(0);
    const before = await fetch(`${apiBase(testInfo)}/api/projects/${id}/share-links`, {
      headers: { Authorization: `Bearer ${data.fixture.token}` },
    }).then((r) => json<unknown[]>(r));
    await dialog.getByTestId("embed-create-guest").click();
    await expect(url).toHaveValue(new RegExp(`^${origin}/share/[A-Za-z0-9_-]{20,}\\?embed=1$`));
    await expect(dialog).toContainText("You won't see this link again");
    const after = await fetch(`${apiBase(testInfo)}/api/projects/${id}/share-links`, {
      headers: { Authorization: `Bearer ${data.fixture.token}` },
    }).then((r) => json<unknown[]>(r));
    expect(after.length).toBe(before.length + 1);

    // That link renders the guest embed for a signed-out visitor.
    const guestCtx = await page.context().browser()!.newContext({ baseURL });
    const guest = await guestCtx.newPage();
    try {
      await guest.goto(await url.inputValue());
      await expect(guest.getByTestId("guest-embed")).toBeVisible();
    } finally {
      await guestCtx.close();
    }

    // Closing drops the one-time link.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("no Embed in Outline item while no Outline address is set", async ({ page }) => {
    await withSession(page, data.fixture.token);
    await withOutlineAddress(page, null);
    await page.goto(`/projects/${data.fixture.projectId}/overview`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "More project actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete project" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Embed in Outline" })).toHaveCount(0);
  });

  test("embed dialog: a project member who is not an owner is told to ask the owner for a guest link", async ({
    browser,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";
    const admin = await login(base);
    const H = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
    const username = `e2e-embed-m-${stamp()}`;
    const email = `${username}@solvro.test`;
    const member = await json<{ id: number }>(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ email, username, password: PASSWORD, role: "TAM" }),
      }),
    );
    await json(
      await fetch(`${base}/api/projects/${data.fixture.projectId}/members`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ userId: member.id }),
      }),
    );
    const { token } = await login(base, email, PASSWORD);
    const ctx = await browser.newContext({ baseURL });
    const memberPage = await ctx.newPage();
    try {
      await withSession(memberPage, token);
      await withOutlineAddress(memberPage);
      await memberPage.goto(`/projects/${data.fixture.projectId}/overview`, { waitUntil: "networkidle" });
      await memberPage.getByRole("button", { name: "More project actions" }).click();
      await memberPage.getByRole("menuitem", { name: "Embed in Outline" }).click();
      const dialog = memberPage.getByRole("dialog", { name: "Embed in Outline" });
      await expect(dialog.getByTestId("embed-link-url")).toHaveValue(
        new RegExp(`/embed/projects/${data.fixture.projectId}/tasks$`),
      );
      await dialog.getByLabel("Anyone with the link").check();
      await expect(dialog.getByTestId("embed-guest-owner-hint")).toContainText(
        "Ask the project owner for a guest link.",
      );
      await expect(dialog.getByTestId("embed-create-guest")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  // Unknown paths under the framable prefixes must render in place, never
  // redirect into the app (the widened frame-ancestors covers the prefix).
  for (const [path, kind] of [
    ["/embed/x", "embed link"],
    ["/embed/projects/1/nope", "embed link"],
    ["/share/a/b", "guest link"],
  ] as const) {
    for (const signedIn of [true, false]) {
      test(`unknown path ${path} (${signedIn ? "signed in" : "signed out"}) shows the invalid card in place`, async ({ page }) => {
        await withSession(page, signedIn ? data.fixture.token : null);
        await page.goto(path);
        await expect(page.getByTestId("embed-invalid-link")).toContainText(`This ${kind} isn't valid`);
        // Give a client-side redirect every chance to fire, then check it did not.
        await page.waitForTimeout(500);
        expect(new URL(page.url()).pathname).toBe(path);
        await expect(page.locator("aside, nav")).toHaveCount(0);
        const out = page.getByRole("link", { name: /Open Solvro/ });
        await expect(out).toHaveAttribute("target", "_blank");
        await expect(out).toHaveAttribute("rel", /noopener/);
      });
    }
  }

  test("no access: a viewer who cannot see the project gets the access card", async ({ page }, testInfo) => {
    const base = apiBase(testInfo);
    const admin = await login(base);
    const username = `e2e-embed-${stamp()}`;
    const email = `${username}@solvro.test`;
    await json(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password: PASSWORD, role: "TAM" }),
      }),
    );
    const outsider = await login(base, email, PASSWORD);

    await withSession(page, outsider.token);
    await page.goto(`/embed/projects/${data.fixture.projectId}/tasks`);
    await expect(page.getByTestId("embed-no-access")).toContainText("You don't have access to this project");
    await expect(page.getByText(data.overdue)).toHaveCount(0);
    await expect(page.getByTestId("embed-signin")).toHaveCount(0);
  });
});
