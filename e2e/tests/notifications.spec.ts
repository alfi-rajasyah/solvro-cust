import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { login } from "../fixtures/seed";

// In-app notifications (docs/archive/plans/collaboration-and-sharing.md, C5b):
// the top-bar bell shows an unread badge, the list opens the task and marks it
// read, and "Mark all as read" clears the rest. User B writes through the API;
// user A watches the bell in the browser.
//
// Like the other collaboration specs, the users/projects created here have no
// cleanup path.

const PASSWORD = "NotifyTest1234!";

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

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function setup(base: string) {
  const admin = await login(base);
  const s = stamp();

  async function makeUser(tag: string) {
    const username = `e2e-nt-${tag}-${s}`;
    const email = `${username}@solvro.test`;
    const created = await json<{ id: number }>(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: headers(admin.token),
        body: JSON.stringify({ email, username, password: PASSWORD, role: "TAM" }),
      }),
    );
    const session = await login(base, email, PASSWORD);
    return { id: created.id, email, username, token: session.token };
  }

  const a = await makeUser("a");
  const b = await makeUser("b");
  const customer = await json<{ id: number }>(
    await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: headers(admin.token),
      body: JSON.stringify({ name: `Notify Customer ${s}`, description: "e2e notifications", tamId: b.id }),
    }),
  );
  const project = await json<{ id: number }>(
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: headers(admin.token),
      body: JSON.stringify({
        name: `Notify Project ${s}`,
        description: "e2e notifications",
        customerId: customer.id,
        tamId: b.id,
        status: "ACTIVE",
      }),
    }),
  );
  return { a, b, projectId: project.id, stamp: s };
}

test.describe("Notifications", () => {
  test("an assignment and a comment notify the assignee; reading clears the badge", async (
    { page },
    testInfo,
  ) => {
    test.setTimeout(90_000);
    const base = apiBase(testInfo);
    const { a, b, projectId, stamp: s } = await setup(base);
    const title = `Notify task ${s}`;

    // B assigns a task to A.
    const task = await json<{ id: number }>(
      await fetch(`${base}/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: headers(b.token),
        body: JSON.stringify({ title, assignedToId: a.id }),
      }),
    );

    await loginViaUi(page, a.email, PASSWORD);
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });

    const bell = page.getByTestId("notifications-button");
    await expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
    await expect(page.getByTestId("notifications-badge")).toHaveText("1");

    // The list names the actor, the reason and the task; unread is marked in text too.
    await bell.click();
    const items = page.getByTestId("notification-item");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(`${b.username} assigned you ${title}`);
    await expect(items.first()).toContainText("Unread");
    await expect(items.first()).toHaveAttribute("data-unread", "true");

    // Clicking opens the task and clears the badge.
    await items.first().click();
    await expect(page).toHaveURL(new RegExp(`task=${task.id}`));
    await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
    await expect(bell).toHaveAttribute("aria-label", "Notifications");
    await expect(page.getByTestId("notifications-badge")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The row stays in the list, now read.
    await bell.click();
    await expect(page.getByTestId("notification-item").first()).toHaveAttribute("data-unread", "false");
    await page.keyboard.press("Escape");

    // B comments on A's task: A is notified again.
    await json(
      await fetch(`${base}/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: headers(b.token),
        body: JSON.stringify({ body: "Please take a look" }),
      }),
    );
    await page.reload({ waitUntil: "networkidle" });
    await expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
    await bell.click();
    await expect(page.getByTestId("notification-item")).toHaveCount(2);
    await expect(page.getByTestId("notification-item").first()).toContainText(
      `${b.username} commented on ${title}`,
    );
    // The comment text itself never appears.
    await expect(page.getByTestId("notification-item").first()).not.toContainText("Please take a look");

    // Mark all as read.
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(bell).toHaveAttribute("aria-label", "Notifications");
    await expect(page.locator('[data-testid="notification-item"][data-unread="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  });

  test("with nothing to read the list shows the caught-up state", async ({ page }, testInfo) => {
    const base = apiBase(testInfo);
    // A is neither the TAM nor a member of the project, so nothing reaches them.
    const { a } = await setup(base);
    await loginViaUi(page, a.email, PASSWORD);
    await page.goto("/projects", { waitUntil: "networkidle" });
    const bell = page.getByTestId("notifications-button");
    await expect(bell).toHaveAttribute("aria-label", "Notifications");
    await bell.click();
    await expect(page.getByText("You're all caught up")).toBeVisible();
  });

  test("being made a project's TAM notifies them", async ({ page }, testInfo) => {
    const base = apiBase(testInfo);
    const { b, projectId } = await setup(base);
    await loginViaUi(page, b.email, PASSWORD);
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
    const bell = page.getByTestId("notifications-button");
    await expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
    await bell.click();
    await expect(page.getByTestId("notification-item").first()).toContainText("made you TAM of Notify Project");
  });
});
