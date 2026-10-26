import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// GET /tasks returns 200 rows per page; the Tasks page must offer a way to
// reach the rest ("Load more") instead of stopping at "Showing 200 of N".

test("Tasks page loads the next page of results", async ({ page, seededProject }, testInfo) => {
  test.setTimeout(180_000);
  const base = apiBase(testInfo);
  const tag = Date.now().toString(36);
  // Enough open tasks that the cross-project list always exceeds one page.
  const need = 205;
  for (let i = 0; i < need; i += 25) {
    await Promise.all(
      Array.from({ length: Math.min(25, need - i) }, (_, j) =>
        createTask(base, seededProject.token, seededProject.projectId, {
          title: `LoadMore ${tag} ${i + j}`,
        }),
      ),
    );
  }

  await loginViaUi(page);
  await page.goto("/tasks", { waitUntil: "networkidle" });

  const status = page.getByText(/^Showing 200 of \d+$/);
  await expect(status).toBeVisible();
  const total = Number((await status.textContent())!.match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThan(200);

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(async () => {
    const rows = await page.getByRole("row").count();
    expect(rows).toBeGreaterThan(201);
  }).toPass();
  if (total > 400) {
    await expect(page.getByText(/^Showing 400 of \d+$/)).toBeVisible();
  } else {
    await expect(page.getByText(/^Showing/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  }
});
