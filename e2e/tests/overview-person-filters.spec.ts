import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask, isoDateOffset } from "../fixtures/seed";

// Overview TAM / Assignee pickers: the choice lives in the URL, survives a
// reload, and a tile link lands on a /tasks list with exactly the tile's count
// (subtasks included once an assignee is chosen).

test("assignee filter persists on reload and the Overdue tile matches the Tasks list", async ({
  page,
  seededProject,
}, testInfo) => {
  const base = apiBase(testInfo);
  const { token, userId, projectId } = seededProject;
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // An overdue task and an overdue subtask, both assigned to the admin.
  const parent = await createTask(base, token, projectId, {
    title: `Person filter parent ${Date.now()}`,
    dueDate: isoDateOffset(-5),
  });
  const sub = await createTask(base, token, projectId, {
    title: `Person filter sub ${Date.now()}`,
    parentTaskId: parent.id,
    dueDate: isoDateOffset(-4),
  });
  for (const t of [parent, sub]) {
    const res = await fetch(`${base}/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ assignedToId: userId }),
    });
    expect(res.ok).toBe(true);
  }
  const me = (await (await fetch(`${base}/api/auth/me`, { headers: auth })).json()) as {
    username?: string;
    user?: { username: string };
  };
  const username = me.username ?? me.user!.username;

  await loginViaUi(page);
  await page.goto("/overview");

  // Pick the assignee through the UI.
  await page.getByRole("combobox", { name: "Assignee filter" }).click();
  await page.getByRole("option", { name: username, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`assigneeId=${userId}`));

  // Reload: the filter comes back from the URL.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Assignee filter" })).toContainText(username);
  const tile = page.getByRole("link", { name: /^Overdue: \d+/ });
  await expect(tile).toContainText(`assigned to ${username}`);
  const count = Number((await tile.getAttribute("aria-label"))!.match(/Overdue: (\d+)/)![1]);
  expect(count).toBeGreaterThanOrEqual(2);

  await tile.click();
  await expect(page).toHaveURL(/\/tasks\?.*assigneeId=/);
  await expect(page.getByRole("button", { name: `Remove filter: Assigned to ${username}` })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(count);

  // The chip removes the filter and drops the param.
  await page.getByRole("button", { name: /Remove filter: Assigned to/ }).click();
  await expect(page).not.toHaveURL(/assigneeId=/);
});
