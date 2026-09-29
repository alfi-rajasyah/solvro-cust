import { test, expect, loginViaUi, submitLoginForm } from "../fixtures/test";

// A signed-out visit to a deep link (project URL + ?task=) must survive the
// sign-in redirect: AuthGuard keeps pathname + search + hash, Login returns
// there. Also covers the Copy link buttons that produce such links.

test.describe("deep links", () => {
  test("signed out → /projects/:id?task=:tid → sign in → task panel is open", async ({
    page,
    seededProject,
  }) => {
    const { projectId, alpha } = seededProject;

    await page.goto(`/projects/${projectId}?task=${alpha.id}`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login/);

    await submitLoginForm(page);

    await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}[^?]*\\?task=${alpha.id}$`));

    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText(alpha.title).first()).toBeVisible();
  });

  test("a link to a task that does not exist shows Task not found, not a spinner", async ({
    page,
    seededProject,
  }) => {
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/list?task=999999999`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByText("Task not found")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Loading task…")).toHaveCount(0);
  });

  test("Copy link buttons put the current page / task URL on the clipboard", async ({
    page,
    context,
    seededProject,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "clipboard check runs once, on desktop");
    const { projectId, alpha, customerId } = seededProject;
    const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost:8080").origin;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/projects/${projectId}/list`,
    );

    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    await panel.getByRole("button", { name: "Copy task link" }).click();
    await expect(panel.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/projects/${projectId}?task=${alpha.id}`,
    );

    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/customers/${customerId}`,
    );
  });
});
