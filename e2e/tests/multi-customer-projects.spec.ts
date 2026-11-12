import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask, login } from "../fixtures/seed";

// One project, several customers (docs/archive/plans/multi-customer-projects.md,
// Phase B). Through the UI: create a project with two customers and choose the
// primary, check the header, rename it and see both customers survive, see the
// "Shared" tag on the secondary customer's page. A second TAM who owns only the
// secondary customer opens the project. With two iTop-mapped customers the
// New-ticket sheet offers an Organisation picker (iTop is faked by intercepting
// /api/itop/*; `serviceWorkers: "block"` like the other iTop specs).

const ITOP_BASE_URL = "https://itop.example.test";

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function json<T>(pending: Response | Promise<Response>): Promise<T> {
  const res = await pending;
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

test.describe("Projects linked to several customers", () => {
  test.use({ serviceWorkers: "block" });

  test("create with two customers, rename keeps both, tag on the secondary, secondary's TAM opens it, org picker", async ({
    page,
    browser,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const admin = await login(base);
    const H = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
    const s = stamp();
    const password = "McpTamTest1234!";

    // Two TAMs: TAM1 owns the SECONDARY customer only; TAM2 owns the primary.
    const mkUser = (tag: string) =>
      json<{ id: number }>(
        fetch(`${base}/api/admin/users`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ email: `e2e-mcp-${tag}-${s}@solvro.test`, username: `e2e-mcp-${tag}-${s}`, password, role: "TAM" }),
        }),
      );
    const tam1 = await mkUser("one");
    const tam2 = await mkUser("two");
    const mkCustomer = (name: string, tamId: number) =>
      json<{ id: number }>(
        fetch(`${base}/api/customers`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ name, description: "e2e multi-customer fixture", tamId }),
        }),
      );
    const secondaryName = `MCP Secondary ${s}`;
    const primaryName = `MCP Primary ${s}`;
    const secondary = await mkCustomer(secondaryName, tam1.id);
    const primary = await mkCustomer(primaryName, tam2.id);

    // --- Create through the form: add both, then make the second one primary.
    const projectName = `MCP Project ${s}`;
    await loginViaUi(page);
    await page.goto("/projects", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByRole("textbox").first().fill(projectName);
    const add = dialog.getByLabel("Add customer");
    await add.selectOption({ label: secondaryName });
    await add.selectOption({ label: primaryName });
    await expect(dialog.getByTestId("project-customer-row")).toHaveCount(2);
    await dialog.getByRole("radio", { name: `Make ${primaryName} the primary customer` }).check();
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog).toBeHidden();

    const list = await json<{ id: number; name: string }[]>(
      fetch(`${base}/api/projects`, { headers: H }),
    );
    const project = list.find((p) => p.name === projectName);
    expect(project, "the project was created").toBeTruthy();
    const projectId = project!.id;

    // --- Header: both customers, the primary tagged.
    await page.goto(`/projects/${projectId}`, { waitUntil: "networkidle" });
    const facts = page.getByRole("group", { name: "Project facts" });
    await expect(facts.getByRole("link", { name: primaryName })).toBeVisible();
    await expect(facts.getByRole("link", { name: secondaryName })).toBeVisible();
    await expect(facts.getByText("Primary", { exact: true })).toHaveCount(1);

    // --- Rename: both customers survive.
    // Edit lives in the project actions menu at every width.
    await page.getByRole("button", { name: "More project actions" }).click();
    await page.getByRole("menuitem", { name: "Edit project" }).click();
    const edit = page.getByRole("dialog", { name: "Edit project" });
    await expect(edit.getByTestId("project-customer-row")).toHaveCount(2);
    const renamed = `${projectName} renamed`;
    await edit.getByRole("textbox").first().fill(renamed);
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden();
    const after = await json<{ name: string; customers: { id: number; isPrimary: boolean }[] }>(
      fetch(`${base}/api/projects/${projectId}`, { headers: H }),
    );
    expect(after.name).toBe(renamed);
    expect(after.customers.map((c) => [c.id, c.isPrimary])).toEqual([
      [primary.id, true],
      [secondary.id, false],
    ]);

    // --- The secondary customer's page tags the project as shared.
    await page.goto(`/customers/${secondary.id}`, { waitUntil: "networkidle" });
    await expect(page.getByText(`Shared · primary: ${primaryName}`)).toBeVisible();

    // --- TAM1 owns only the secondary customer and still opens the project.
    const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: "block" });
    const tamPage = await ctx.newPage();
    await loginViaUi(tamPage, `e2e-mcp-one-${s}@solvro.test`, password);
    await tamPage.goto(`/projects/${projectId}`, { waitUntil: "networkidle" });
    await expect(tamPage.getByRole("link", { name: primaryName }).first()).toBeVisible();
    await ctx.close();

    // --- iTop: two mapped customers -> Organisation picker in the New-ticket sheet.
    const task = await createTask(base, admin.token, projectId, { title: `MCP task ${s}` });
    await page.route("**/api/itop/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          baseUrl: ITOP_BASE_URL,
          lastSyncAt: new Date().toISOString(),
          lastSyncOk: true,
          refreshMinutes: 5,
          actionsEnabled: true,
        }),
      }),
    );
    await page.route("**/api/itop/me/token", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ set: true, personName: "QA Admin", checkedAt: new Date().toISOString(), expiresAt: null, actionsEnabled: true, configured: true }),
      }),
    );
    for (const c of [primary, secondary]) {
      await page.route(`**/api/itop/customers/${c.id}/tickets*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            mapped: true,
            orgName: `Org ${c.id}`,
            tickets: [],
            counts: { ongoing: 0, resolvedWeek: 0, mine: 0, incidents: 0, requests: 0 },
            syncedAt: new Date().toISOString(),
          }),
        }),
      );
      await page.route(`**/api/itop/customers/${c.id}/contacts`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ id: 40 + (c.id % 50), name: `Contact ${c.id}`, email: `c${c.id}@fixture.test` }]),
        }),
      );
    }
    await page.route("**/api/itop/services", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.route("**/api/itop/tickets/by-refs*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
    await page.route("**/api/itop/tickets", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ id: 9100, stale: true }),
      });
    });

    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Add iTop ticket to ${task.title}` }).click();
    await page.getByRole("menuitem", { name: "Create iTop ticket…" }).click();
    const sheet = page.getByRole("dialog", { name: "New ticket" });
    await expect(sheet).toBeVisible();
    const org = sheet.getByLabel("Organisation");
    await expect(org).toBeVisible();
    // Default = the primary customer.
    await expect(org).toHaveValue(String(primary.id));
    await expect(org.locator("option")).toHaveText([primaryName, secondaryName]);
    await org.selectOption(String(secondary.id));
    await sheet.getByLabel(/Caller/).selectOption({ index: 1 });
    await sheet.getByLabel(/Description/).fill("from the e2e");
    const post = page.waitForRequest((req) => req.method() === "POST" && req.url().endsWith("/api/itop/tickets"));
    await sheet.getByRole("button", { name: "Create in iTop" }).click();
    expect((await post).postDataJSON()).toMatchObject({ customerId: secondary.id });
  });
});
