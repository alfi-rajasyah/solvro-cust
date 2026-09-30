import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { login } from "../fixtures/seed";

// @mentions in task comments (docs/archive/plans/collaboration-and-sharing.md,
// C5c). User A owns a project and adds B as a member; A mentions B from the
// task panel's comment box, B's bell reports it. Like the other collaboration
// specs, the users/projects created here have no cleanup path.

const PASSWORD = "MentionTest1234!";

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
    // Dots and dashes in the name exercise the token matching.
    const username = `e2e-mn.${tag}-${s}`;
    const email = `e2e-mn-${tag}-${s}@solvro.test`;
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
      body: JSON.stringify({ name: `Mention Customer ${s}`, description: "e2e mentions", tamId: a.id }),
    }),
  );
  const project = await json<{ id: number }>(
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: headers(admin.token),
      body: JSON.stringify({
        name: `Mention Project ${s}`,
        description: "e2e mentions",
        customerId: customer.id,
        tamId: a.id,
        status: "ACTIVE",
      }),
    }),
  );
  await json(
    await fetch(`${base}/api/projects/${project.id}/members`, {
      method: "POST",
      headers: headers(a.token),
      body: JSON.stringify({ userId: b.id }),
    }),
  );
  const title = `Mention task ${s}`;
  const task = await json<{ id: number }>(
    await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: "POST",
      headers: headers(a.token),
      body: JSON.stringify({ title }),
    }),
  );
  return { a, b, projectId: project.id, taskId: task.id, title };
}

test.describe("Comment mentions", () => {
  test("picking a name mentions them: chip in the thread, notification for them", async (
    { page, browser },
    testInfo,
  ) => {
    test.setTimeout(90_000);
    const base = apiBase(testInfo);
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";
    const { a, b, projectId, taskId, title } = await setup(base);

    await loginViaUi(page, a.email, PASSWORD);
    await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible();

    const composer = panel.getByRole("combobox", { name: "Write a comment" });
    await composer.click();
    await composer.pressSequentially("hey @e2e-mn.b");
    const picker = panel.getByRole("listbox", { name: "Mention someone" });
    await expect(picker).toBeVisible();
    await expect(composer).toHaveAttribute("aria-expanded", "true");
    // The query narrows the list to B.
    await expect(picker.getByRole("option")).toHaveCount(1);
    await expect(picker.getByRole("option", { name: new RegExp(b.username) })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await composer.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(composer).toHaveValue(`hey @${b.username} `);
    await composer.pressSequentially("please review.");

    const posted = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().includes(`/tasks/${taskId}/comments`),
    );
    await panel.getByRole("button", { name: "Send comment" }).click();
    expect((await posted).postDataJSON()).toEqual({
      body: `hey @${b.username} please review.`,
      mentionedUserIds: [b.id],
    });

    // The stored mention renders as a chip; the rest stays plain text.
    const chip = panel.getByTestId("mention-chip");
    await expect(chip).toHaveText(`@${b.username}`);
    await expect(panel.getByText("please review.")).toBeVisible();

    // B, in their own browser context, is told.
    const ctxB = await browser.newContext({ baseURL });
    const pageB = await ctxB.newPage();
    try {
      await loginViaUi(pageB, b.email, PASSWORD);
      await pageB.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
      const bell = pageB.getByTestId("notifications-button");
      await expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
      await bell.click();
      await expect(pageB.getByTestId("notification-item").first()).toContainText(
        `${a.username} mentioned you on ${title}`,
      );
    } finally {
      await ctxB.close();
    }
  });

  test("a mention deleted before sending sends no id; Escape closes only the picker", async (
    { page },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const { a, b, projectId, taskId } = await setup(base);

    await loginViaUi(page, a.email, PASSWORD);
    await page.goto(`/projects/${projectId}/list?task=${taskId}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    const composer = panel.getByRole("combobox", { name: "Write a comment" });
    await composer.click();

    // Escape dismisses the picker but leaves the task panel open.
    await composer.pressSequentially("@e2e");
    const picker = panel.getByRole("listbox", { name: "Mention someone" });
    await expect(picker).toBeVisible();
    await composer.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(panel).toBeVisible();

    // Pick with the mouse, then delete the inserted text again.
    await composer.fill("");
    await composer.pressSequentially("@e2e");
    await picker.getByRole("option", { name: new RegExp(b.username) }).click();
    await expect(composer).toHaveValue(`@${b.username} `);
    for (let i = 0; i < b.username.length + 2; i++) await composer.press("Backspace");
    await composer.pressSequentially("never mind");

    const posted = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().includes(`/tasks/${taskId}/comments`),
    );
    await panel.getByRole("button", { name: "Send comment" }).click();
    expect((await posted).postDataJSON()).toEqual({ body: "never mind" });
    await expect(panel.getByText("never mind")).toBeVisible();
    await expect(panel.getByTestId("mention-chip")).toHaveCount(0);
  });
});
