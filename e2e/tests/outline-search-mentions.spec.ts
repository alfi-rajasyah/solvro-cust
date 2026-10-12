import type { Page, Route, TestInfo } from "@playwright/test";
import { test, expect, loginViaUi, apiBase } from "../fixtures/test";

// Outline inside Solvro, part 2 (docs/archive/plans/outline-integration.md, B7):
//  - the ⌘K palette's "Outline" group (its own query, after Solvro's results);
//  - "Mentioned in Outline" on the task panel and the project Overview.
// Outline itself is never contacted: the browser's /api/outline/* calls and the
// two mentions endpoints are answered by Playwright route mocks, so this runs
// on any stack. Serialize with other Playwright users of the stack:
//   flock /tmp/solvro-e2e.lock npx playwright test tests/outline-search-mentions.spec.ts --retries=0

// The CI stack serves the built app, whose PWA service worker would answer
// the mocked /api fetches itself and bypass page.route (same as the iTop specs).
test.use({ serviceWorkers: "block" });

const DOCS = "https://docs.example.test";
const DOC_URL = `${DOCS}/doc/launch-runbook-abc123`;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

interface MockOptions {
  baseUrl?: string | null;
  me?: { configured: boolean; connected: boolean };
  /** Fulfils GET /outline/search; default: one hit with a highlighted snippet. */
  search?: (route: Route) => Promise<void>;
}

const HITS = [
  {
    id: "doc-1",
    title: "Launch runbook",
    url: DOC_URL,
    snippet: [
      { text: "Before the ", highlight: false },
      { text: "launch", highlight: true },
      { text: " every owner signs off the checklist.", highlight: false },
    ],
  },
  {
    // Markup in Outline content must stay text.
    id: "doc-2",
    title: "<b>Not bold</b> notes",
    url: `${DOCS}/doc/notes-def456`,
    snippet: [{ text: "<img src=x onerror=alert(1)>", highlight: false }],
  },
];

/** Registers the Outline mocks on the page; returns the recorded search requests. */
async function mockOutline(page: Page, opts: MockOptions = {}): Promise<{ searches: string[] }> {
  const searches: string[] = [];
  const baseUrl = opts.baseUrl === undefined ? DOCS : opts.baseUrl;
  await page.route("**/api/outline/config", (route) => json(route, 200, { baseUrl }));
  await page.route("**/api/outline/me", (route) =>
    json(route, 200, {
      ...(opts.me ?? { configured: true, connected: true }),
      outlineEmail: null,
      expiresAt: null,
    }),
  );
  await page.route("**/api/outline/search**", async (route) => {
    searches.push(new URL(route.request().url()).searchParams.get("q") ?? "");
    if (opts.search) return opts.search(route);
    return json(route, 200, HITS);
  });
  // The doc pages themselves (new tabs) must not hit the network.
  await page.context().route(`${DOCS}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><title>doc</title></html>" }),
  );
  return { searches };
}

async function createUniqueTask(testInfo: TestInfo, token: string, projectId: number) {
  const title = `OutlineTarget ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const res = await fetch(`${apiBase(testInfo)}/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`task seed failed: ${res.status}`);
  const body = (await res.json()) as { id: number };
  return { id: body.id, title };
}

async function openPalette(page: Page, testInfo: TestInfo) {
  await page.goto("/overview", { waitUntil: "networkidle" });
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: /open search/i }).click();
  } else {
    await page.keyboard.press("ControlOrMeta+k");
  }
  const dialog = page.getByRole("dialog", { name: /global search/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("⌘K Outline group", () => {
  test("Solvro results show first, the Outline group follows, snippets highlight and render as text", async ({
    page,
    seededProject,
  }, testInfo) => {
    const target = await createUniqueTask(testInfo, seededProject.token, seededProject.projectId);
    await loginViaUi(page);
    // Outline answers slowly: Solvro's own rows must not wait for it.
    const { searches } = await mockOutline(page, {
      search: async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await json(route, 200, HITS);
      },
    });

    const dialog = await openPalette(page, testInfo);
    await dialog.getByPlaceholder(/search projects/i).fill(target.title);

    await expect(dialog.getByText(target.title, { exact: true })).toBeVisible();
    const status = dialog.getByTestId("outline-palette-status");
    await expect(status).toContainText("Searching Outline");
    await expect(dialog.getByTestId("outline-result")).toHaveCount(0);

    // …then the Outline group arrives, below Solvro's groups.
    const results = dialog.getByTestId("outline-result");
    await expect(results).toHaveCount(2);
    await expect(status).toBeEmpty();
    const labels = dialog.locator('[data-slot="autocomplete-group-label"]');
    await expect(labels.last()).toHaveText("Outline");
    await expect(labels.nth(0)).not.toHaveText("Outline");

    // Highlight is a <mark>; the match is the only marked text.
    const first = results.first();
    await expect(first).toContainText("Launch runbook");
    await expect(first.locator("mark")).toHaveText("launch");
    await expect(first).toContainText("Before the launch every owner signs off the checklist.");

    // Markup stays text: no <b>/<img> was created from Outline content.
    const second = results.nth(1);
    await expect(second).toContainText("<b>Not bold</b> notes");
    await expect(second).toContainText("<img src=x onerror=alert(1)>");
    await expect(second.locator("b, img")).toHaveCount(0);

    // One search call for the settled query (debounced), never one per keystroke.
    expect(searches).toEqual([target.title]);
  });

  test("selecting an Outline page opens it in a new tab and closes the palette", async ({
    page,
    seededProject,
  }, testInfo) => {
    const target = await createUniqueTask(testInfo, seededProject.token, seededProject.projectId);
    await loginViaUi(page);
    await mockOutline(page);

    const dialog = await openPalette(page, testInfo);
    await dialog.getByPlaceholder(/search projects/i).fill(target.title);
    const row = dialog.getByTestId("outline-result").first();
    await expect(row).toBeVisible();

    const [popup] = await Promise.all([page.context().waitForEvent("page"), row.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(DOC_URL);
    await expect(dialog).toBeHidden();
  });

  test("keyboard navigation runs from Solvro's rows into the Outline group", async ({
    page,
    seededProject,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "keyboard navigation is a desktop concern");
    const target = await createUniqueTask(testInfo, seededProject.token, seededProject.projectId);
    await loginViaUi(page);
    await mockOutline(page);

    const dialog = await openPalette(page, testInfo);
    const input = dialog.getByPlaceholder(/search projects/i);
    await input.fill(target.title);
    await expect(dialog.getByTestId("outline-result")).toHaveCount(2);

    // The first highlighted row is Solvro's task; ArrowDown walks into Outline.
    const highlighted = dialog.locator("[data-highlighted]");
    await expect(highlighted.first()).toContainText(target.title);
    for (let i = 0; i < 4; i++) {
      if ((await highlighted.first().getByTestId("outline-result").count()) > 0) break;
      await input.press("ArrowDown");
    }
    await expect(highlighted.first()).toContainText("Launch runbook");

    const [popup] = await Promise.all([page.context().waitForEvent("page"), input.press("Enter")]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(DOC_URL);
  });

  test("a user who has not connected Outline gets a hint to connect, and no search call", async ({
    page,
    seededProject,
  }, testInfo) => {
    const target = await createUniqueTask(testInfo, seededProject.token, seededProject.projectId);
    await loginViaUi(page);
    const { searches } = await mockOutline(page, { me: { configured: true, connected: false } });

    const dialog = await openPalette(page, testInfo);
    await dialog.getByPlaceholder(/search projects/i).fill(target.title);
    await expect(dialog.getByText(target.title, { exact: true })).toBeVisible();

    const hint = dialog.getByTestId("outline-palette-status");
    await expect(hint).toContainText("to search your pages");
    await hint.getByRole("link", { name: "Connect Outline" }).click();
    await page.waitForURL(/\/settings/);
    expect(searches).toEqual([]);
  });

  test("nothing Outline-related shows while no Outline address is set", async ({
    page,
    seededProject,
  }, testInfo) => {
    const target = await createUniqueTask(testInfo, seededProject.token, seededProject.projectId);
    await loginViaUi(page);
    const { searches } = await mockOutline(page, {
      baseUrl: null,
      me: { configured: false, connected: false },
    });
    // No Outline address: not even the connection is asked about.
    let meCalls = 0;
    await page.route("**/api/outline/me", (route) => {
      meCalls += 1;
      return route.fallback();
    });

    const dialog = await openPalette(page, testInfo);
    await dialog.getByPlaceholder(/search projects/i).fill(target.title);
    await expect(dialog.getByText(target.title, { exact: true })).toBeVisible();
    await page.waitForTimeout(700); // past the Outline debounce
    await expect(dialog.getByTestId("outline-palette-status")).toBeEmpty();
    await expect(dialog.getByTestId("outline-result")).toHaveCount(0);
    expect(searches).toEqual([]);
    expect(meCalls).toBe(0);
  });

  test("a rate-limited Outline shows a quiet note and Solvro's results stay", async ({
    page,
    seededProject,
  }, testInfo) => {
    const target = await createUniqueTask(testInfo, seededProject.token, seededProject.projectId);
    await loginViaUi(page);
    await mockOutline(page, {
      search: (route) =>
        json(route, 429, {
          error: "Outline is busy. Try again shortly.",
          code: "outline_rate_limited",
          details: { retryAfter: 30 },
        }),
    });

    const dialog = await openPalette(page, testInfo);
    await dialog.getByPlaceholder(/search projects/i).fill(target.title);
    await expect(dialog.getByText(target.title, { exact: true })).toBeVisible();
    await expect(dialog.getByTestId("outline-palette-status")).toContainText("Outline is busy");
    await expect(dialog.getByTestId("outline-result")).toHaveCount(0);
  });

  test("no Outline results is quiet: no group, no note", async ({ page, seededProject }, testInfo) => {
    const target = await createUniqueTask(testInfo, seededProject.token, seededProject.projectId);
    await loginViaUi(page);
    const { searches } = await mockOutline(page, { search: (route) => json(route, 200, []) });

    const dialog = await openPalette(page, testInfo);
    await dialog.getByPlaceholder(/search projects/i).fill(target.title);
    await expect(dialog.getByText(target.title, { exact: true })).toBeVisible();
    await expect.poll(() => searches.length).toBe(1);
    await expect(dialog.getByTestId("outline-palette-status")).toBeEmpty();
    await expect(dialog.locator('[data-slot="autocomplete-group-label"]', { hasText: "Outline" })).toHaveCount(0);
  });
});

test.describe("Mentioned in Outline", () => {
  async function mockTaskMentions(page: Page, taskId: number, body: unknown) {
    await page.route(`**/api/tasks/${taskId}/outline-mentions`, (route) => json(route, 200, body));
  }

  test("task panel: visible pages are links, hidden ones are a count", async ({ page, seededProject }) => {
    const { projectId, alpha } = seededProject;
    await loginViaUi(page);
    await mockOutline(page);
    await mockTaskMentions(page, alpha.id, {
      connected: true,
      visible: [
        { docId: "d1", title: "Launch runbook", url: DOC_URL },
        { docId: "d2", title: "Kickoff notes", url: `${DOCS}/doc/kickoff-xyz789` },
      ],
      hiddenCount: 3,
    });

    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, { waitUntil: "networkidle" });
    const section = page.getByTestId("outline-mentions");
    await expect(section).toContainText("Mentioned in Outline · 5");

    const link = section.getByRole("link", { name: /Launch runbook/ });
    await expect(link).toHaveAttribute("href", DOC_URL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(section.getByRole("link", { name: /Kickoff notes/ })).toBeVisible();

    await expect(section.getByTestId("outline-mentions-hidden")).toContainText("3 more pages you cannot open");
    await expect(section).toContainText("Updates when someone pastes this task's link into an Outline page.");
    // A hidden page's title is nowhere to be found.
    await expect(section).not.toContainText("Secret");
  });

  test("task panel: a single hidden page is singular", async ({ page, seededProject }) => {
    const { projectId, alpha } = seededProject;
    await loginViaUi(page);
    await mockOutline(page);
    await mockTaskMentions(page, alpha.id, { connected: true, visible: [], hiddenCount: 1 });

    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, { waitUntil: "networkidle" });
    const section = page.getByTestId("outline-mentions");
    await expect(section).toContainText("Mentioned in Outline · 1");
    await expect(section.getByTestId("outline-mentions-hidden")).toContainText("1 more page you cannot open");
  });

  test("task panel: without a connection it is a count with a link to connect", async ({
    page,
    seededProject,
  }) => {
    const { projectId, alpha } = seededProject;
    await loginViaUi(page);
    await mockOutline(page, { me: { configured: true, connected: false } });
    await mockTaskMentions(page, alpha.id, { connected: false, total: 4 });

    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, { waitUntil: "networkidle" });
    const section = page.getByTestId("outline-mentions");
    await expect(section).toContainText("Mentioned in Outline · 4");
    const note = section.getByTestId("outline-mentions-unconnected");
    await expect(note).toHaveText("Mentioned in 4 Outline pages — connect Outline to see them");
    await expect(section.getByTestId("outline-mentions-list")).toHaveCount(0);
    await note.getByRole("link", { name: /connect Outline/ }).click();
    await page.waitForURL(/\/settings/);
  });

  test("task panel: no mentions shows the helper while an Outline address is set, nothing otherwise", async ({
    page,
    seededProject,
  }) => {
    const { projectId, alpha } = seededProject;
    await loginViaUi(page);
    await mockOutline(page);
    await mockTaskMentions(page, alpha.id, { connected: true, visible: [], hiddenCount: 0 });

    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, { waitUntil: "networkidle" });
    const section = page.getByTestId("outline-mentions");
    await expect(section).toContainText("Mentioned in Outline · 0");
    await expect(section).toContainText("Updates when someone pastes this task's link");

    // Address unset and no mentions: the section is gone.
    await page.unroute("**/api/outline/config");
    await page.route("**/api/outline/config", (route) => json(route, 200, { baseUrl: null }));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByPlaceholder("Write a comment…")).toBeVisible();
    await expect(page.getByTestId("outline-mentions")).toHaveCount(0);
  });

  test("project Overview: the card lists the project's mentions", async ({ page, seededProject }) => {
    const { projectId } = seededProject;
    await loginViaUi(page);
    await mockOutline(page);
    await page.route(`**/api/projects/${projectId}/outline-mentions`, (route) =>
      json(route, 200, {
        connected: true,
        visible: [{ docId: "d1", title: "Launch runbook", url: DOC_URL }],
        hiddenCount: 2,
      }),
    );

    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
    const card = page.getByTestId("outline-mentions");
    await expect(card).toContainText("Mentioned in Outline · 3");
    await expect(card.getByRole("link", { name: /Launch runbook/ })).toHaveAttribute("href", DOC_URL);
    await expect(card.getByTestId("outline-mentions-hidden")).toContainText("2 more pages you cannot open");
    await expect(card).toContainText("one of its tasks");
  });
});
