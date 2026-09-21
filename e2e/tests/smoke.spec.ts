import { test, expect, loginViaUi, openKanban } from "../fixtures/test";

// Ported from the QA gate script qa-test-docker.mjs. That script's mobile
// touch-drag test predates dnd-kit's TouchSensor 250ms activation delay and
// is stale (it fires touchmove immediately after touchstart, so the drag
// never activates) — dropped here. The proven touch-drag coverage (with the
// correct 250ms hold) lives in kanban-dnd.spec.ts's mobile project instead.
// Everything else — login, kanban render, overflow, console/page errors —
// is kept.

test.describe("smoke", () => {
  test("login succeeds and lands off the login screen", async ({ page }) => {
    await loginViaUi(page);
    await expect(page).not.toHaveURL(/login/i);
  });

  test("kanban board renders seeded cards", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await openKanban(page, seededProject.projectId);

    await expect(page.getByText("Alpha", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Delta", { exact: true }).first()).toBeVisible();
  });

  test("no horizontal overflow on key pages", async ({ page, seededProject }) => {
    test.skip(test.info().project.name !== "mobile", "overflow check is mobile-viewport specific");
    await loginViaUi(page);

    const pages: Array<[string, string]> = [
      ["overview", "/overview"],
      ["project", `/projects/${seededProject.projectId}`],
      ["kanban", `/projects/${seededProject.projectId}/kanban`],
    ];

    for (const [name, path] of pages) {
      await page.goto(path, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${name} (${path}) overflowed by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test("no console/page errors while navigating the app", async ({ page, seededProject }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await openKanban(page, seededProject.projectId);

    expect(errors, errors.slice(0, 5).join(" || ")).toHaveLength(0);
  });
});
