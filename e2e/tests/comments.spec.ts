import type { Locator, Page } from "@playwright/test";
import { apiBase, test, expect, loginViaUi } from "../fixtures/test";
import { login } from "../fixtures/seed";

// Regression for GH #57: comment bodies rendered with whitespace-pre-wrap but
// no break-words, so a long unbroken string (URL, token, keyboard mash)
// overflowed its bubble and painted outside the 380px panel.

test.describe("task panel comments — desktop", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Panel layout asserted at desktop width");
  });

  test("long unbroken comment text wraps inside its bubble", async ({ page, seededProject }) => {
    const { projectId, alpha } = seededProject;
    const long = "W".repeat(300); // no whitespace anywhere — worst case

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, {
      waitUntil: "networkidle",
    });

    const composer = page.getByPlaceholder("Write a comment…");
    await expect(composer).toBeVisible();
    await composer.fill(long);
    await page.getByRole("button", { name: "Send comment" }).click();

    const body = page.getByText(long).first();
    await expect(body).toBeVisible();
    // The paragraph must not overflow its own box…
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    // …nor its bubble (the min-w-0 flex-1 container the header row + paragraph
    // both live in). This is the real containment check: the panel is
    // position:fixed inside an overflow-hidden Shell root, so a
    // document-scrollWidth check would pass even on unfixed code — the
    // overflow paints past the panel edge and never reaches the document.
    expect(
      await body.evaluate((el) => {
        const bubble = el.parentElement!;
        return bubble.scrollWidth - bubble.clientWidth;
      }),
    ).toBeLessThanOrEqual(1);
  });

  test("composer grows with Shift+Enter lines and Enter sends them as one comment", async ({ page, seededProject }) => {
    const { projectId, alpha } = seededProject;
    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, { waitUntil: "networkidle" });

    const composer = page.getByRole("textbox", { name: "Write a comment" });
    const oneLine = (await composer.boundingBox())!.height;
    await composer.fill("first line");
    await composer.press("Shift+Enter");
    await composer.pressSequentially("second line");
    expect((await composer.boundingBox())!.height).toBeGreaterThan(oneLine);

    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(page.getByText("first line").first()).toBeVisible();
    await expect(page.getByText("second line").first()).toBeVisible();
  });
});

// Edit and delete (GH #169). The thread of a SUBTASK, with the author and a
// second project member as two real users. Self-contained: it makes its own
// users (e2e marker: @solvro.test), customer and project, and posts its
// comments through the API, so no other spec file's data is needed.

const PASSWORD = "CommentEdit1234!";

interface Actor {
  id: number;
  email: string;
  token: string;
}

interface Thread {
  author: Actor;
  member: Actor;
  projectId: number;
  subtaskId: number;
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed ${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

async function makeThread(base: string): Promise<Thread> {
  const admin = await login(base);
  const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function makeUser(tag: string): Promise<Actor> {
    const email = `e2e-ce-${tag}-${s}@solvro.test`;
    const created = await json<{ id: number }>(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: headers(admin.token),
        body: JSON.stringify({ email, username: `e2e-ce.${tag}-${s}`, password: PASSWORD, role: "TAM" }),
      }),
    );
    const session = await login(base, email, PASSWORD);
    return { id: created.id, email, token: session.token };
  }

  const author = await makeUser("a");
  const member = await makeUser("b");
  const customer = await json<{ id: number }>(
    await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: headers(admin.token),
      body: JSON.stringify({ name: `Comment Edit Customer ${s}`, description: "e2e comment edit", tamId: author.id }),
    }),
  );
  const project = await json<{ id: number }>(
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: headers(admin.token),
      body: JSON.stringify({
        name: `Comment Edit Project ${s}`,
        description: "e2e comment edit",
        customerId: customer.id,
        tamId: author.id,
        status: "ACTIVE",
      }),
    }),
  );
  await json(
    await fetch(`${base}/api/projects/${project.id}/members`, {
      method: "POST",
      headers: headers(author.token),
      body: JSON.stringify({ userId: member.id }),
    }),
  );
  const parent = await json<{ id: number }>(
    await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: "POST",
      headers: headers(author.token),
      body: JSON.stringify({ title: `Comment parent ${s}` }),
    }),
  );
  const sub = await json<{ id: number }>(
    await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: "POST",
      headers: headers(author.token),
      body: JSON.stringify({ title: `Comment subtask ${s}`, parentTaskId: parent.id }),
    }),
  );
  return { author, member, projectId: project.id, subtaskId: sub.id };
}

let thread: Thread;
let seq = 0;

test.describe("task comments: edit and delete on a subtask", () => {
  test.beforeAll(async ({}, testInfo) => {
    thread = await makeThread(apiBase(testInfo));
  });

  async function postComment(base: string, text: string): Promise<string> {
    const body = `${text} ${Date.now().toString(36)}${seq++}`;
    await json(
      await fetch(`${base}/api/tasks/${thread.subtaskId}/comments`, {
        method: "POST",
        headers: headers(thread.author.token),
        body: JSON.stringify({ body }),
      }),
    );
    return body;
  }

  async function openPanel(page: Page) {
    await page.goto(`/projects/${thread.projectId}/list?task=${thread.subtaskId}`, { waitUntil: "networkidle" });
    const panel = page.getByRole("dialog", { name: "Task details" });
    await expect(panel).toBeVisible();
    return panel;
  }

  const commentRow = (panel: Locator, body: string) => panel.getByRole("listitem").filter({ hasText: body });

  test("the author edits a comment; it shows edited and persists after a reload", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const original = await postComment(apiBase(testInfo), "Original text");
    await loginViaUi(page, thread.author.email, PASSWORD);
    const panel = await openPanel(page);

    const row = commentRow(panel, original);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("comment-edited")).toHaveCount(0);
    const trigger = row.getByRole("button", { name: "Comment actions" });
    if (testInfo.project.name === "mobile") {
      // No hover on a phone: the trigger is shown without it.
      await expect(trigger).toHaveCSS("opacity", "1");
    }
    await trigger.click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    const editor = panel.getByRole("textbox", { name: "Edit comment" });
    await expect(editor).toHaveValue(original);
    const changed = `${original} changed`;
    await editor.fill(changed);
    await panel.getByRole("button", { name: "Save" }).click();

    const edited = commentRow(panel, changed);
    await expect(edited).toBeVisible();
    await expect(edited.getByTestId("comment-edited")).toHaveText("edited");
    await expect(panel.getByRole("textbox", { name: "Edit comment" })).toHaveCount(0);

    await page.reload({ waitUntil: "networkidle" });
    const reloaded = commentRow(page.getByRole("dialog", { name: "Task details" }), changed);
    await expect(reloaded).toBeVisible();
    await expect(reloaded.getByTestId("comment-edited")).toBeVisible();
  });

  test("Escape cancels an edit, keeps the panel open and the text unchanged", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const original = await postComment(apiBase(testInfo), "Keep this");
    await loginViaUi(page, thread.author.email, PASSWORD);
    const panel = await openPanel(page);

    await commentRow(panel, original).getByRole("button", { name: "Comment actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editor = panel.getByRole("textbox", { name: "Edit comment" });
    await expect(editor).toBeFocused();
    await editor.fill("Something else entirely");
    await editor.press("Escape");

    await expect(panel.getByRole("textbox", { name: "Edit comment" })).toHaveCount(0);
    await expect(panel).toBeVisible();
    const row = commentRow(panel, original);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("comment-edited")).toHaveCount(0);
    await expect(panel.getByText("Something else entirely")).toHaveCount(0);
  });

  test("the author deletes a comment after confirming; it is gone after a reload", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const doomed = await postComment(apiBase(testInfo), "Delete me");
    const survivor = await postComment(apiBase(testInfo), "Leave me");
    await loginViaUi(page, thread.author.email, PASSWORD);
    const panel = await openPanel(page);

    await commentRow(panel, doomed).getByRole("button", { name: "Comment actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this comment?" });
    await expect(dialog).toBeVisible();
    // Nothing is removed until the confirm.
    await expect(commentRow(panel, doomed)).toBeVisible();
    await dialog.getByRole("button", { name: "Delete comment" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(commentRow(panel, doomed)).toHaveCount(0);
    await expect(commentRow(panel, survivor)).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    const reloaded = page.getByRole("dialog", { name: "Task details" });
    await expect(commentRow(reloaded, survivor)).toBeVisible();
    await expect(commentRow(reloaded, doomed)).toHaveCount(0);
  });

  test("a second member sees the comment but no Comment actions button", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const body = await postComment(apiBase(testInfo), "Someone else's");
    await loginViaUi(page, thread.member.email, PASSWORD);
    const panel = await openPanel(page);

    await expect(commentRow(panel, body)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Comment actions" })).toHaveCount(0);
  });
});
