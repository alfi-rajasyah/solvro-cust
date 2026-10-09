import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { login } from "../fixtures/seed";

// Project activity log (docs/archive/plans/collaboration-and-sharing.md, C5a):
// the Overview's "Recent activity" section reads newest-first sentences, the
// person filter narrows them, and "Load more" pages past the first 20.
//
// The admin API builds a project owned by a fresh TAM with a second user as a
// member; the TAM and the member then write through the API under their own
// tokens so the events carry two distinct actors. Like the members spec,
// nothing created here has a cleanup path.

const PASSWORD = "ActivityTest1234!";
const PAGE_SIZE = 20; // ACTIVITY_PAGE_SIZE in lib/queries.ts

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

interface Setup {
  owner: { id: number; email: string; username: string; token: string };
  member: { id: number; email: string; username: string; token: string };
  projectId: number;
  firstTitle: string;
  memberTitle: string;
}

async function setup(base: string): Promise<Setup> {
  const admin = await login(base);
  const s = stamp();

  async function makeUser(tag: string) {
    const username = `e2e-act-${tag}-${s}`;
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

  const owner = await makeUser("owner");
  const member = await makeUser("member");

  const customer = await json<{ id: number }>(
    await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: headers(admin.token),
      body: JSON.stringify({ name: `Activity Customer ${s}`, description: "e2e activity fixture", tamId: owner.id }),
    }),
  );
  const project = await json<{ id: number }>(
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: headers(admin.token),
      body: JSON.stringify({
        name: `Activity Project ${s}`,
        description: "e2e activity fixture",
        customerId: customer.id,
        tamId: owner.id,
        status: "ACTIVE",
      }),
    }),
  );
  const projectId = project.id;
  await json(
    await fetch(`${base}/api/projects/${projectId}/members`, {
      method: "POST",
      headers: headers(owner.token),
      body: JSON.stringify({ userId: member.id }),
    }),
  );

  const createTask = (token: string, title: string) =>
    fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ title }),
    }).then((r) => json<{ id: number }>(r));

  // Oldest first: the member's task, then the owner's bulk (enough to spill
  // onto a second page), then a due-date edit, which is the newest event.
  const memberTitle = `Member task ${s}`;
  await createTask(member.token, memberTitle);
  const firstTitle = `Configure backup jobs ${s}`;
  const first = await createTask(owner.token, firstTitle);
  for (let i = 0; i < PAGE_SIZE + 2; i++) await createTask(owner.token, `Bulk ${i} ${s}`);
  for (const dueDate of ["2030-10-02T00:00:00.000Z", "2030-10-05T00:00:00.000Z"]) {
    await json(
      await fetch(`${base}/api/tasks/${first.id}`, {
        method: "PATCH",
        headers: headers(owner.token),
        body: JSON.stringify({ dueDate }),
      }),
    );
  }
  return { owner, member, projectId, firstTitle, memberTitle };
}

test.describe("Project activity", () => {
  test("Overview lists newest-first sentences, filters by person, and pages with Load more", async (
    { page },
    testInfo,
  ) => {
    test.setTimeout(120_000);
    const base = apiBase(testInfo);
    const { owner, member, projectId, firstTitle, memberTitle } = await setup(base);

    await loginViaUi(page, owner.email, PASSWORD);
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });

    const section = page.getByRole("region", { name: "Recent activity" });
    await expect(section).toBeVisible();
    const events = section.getByTestId("activity-event");

    // Newest first: the due-date edit, worded with the day formatter.
    await expect(events).toHaveCount(PAGE_SIZE);
    await expect(events.first()).toContainText(
    `${owner.username} changed the due date of ${firstTitle} from 2 Oct 2030 to 5 Oct 2030`,
    );
    // The edit before it set the date from nothing.
    await expect(events.nth(1)).toContainText(`set the due date of ${firstTitle} to 2 Oct 2030`);
    await expect(events.first().locator("time")).toBeVisible();
    // The task is linked, and following it opens the task panel.
    await events.first().getByRole("link", { name: firstTitle }).click();
    await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Load more pages in the rest, then disappears.
    const loadMore = section.getByRole("button", { name: "Load more" });
    await expect(loadMore).toBeVisible();
    await loadMore.click();
    await expect.poll(() => events.count()).toBeGreaterThan(PAGE_SIZE);
    await expect(loadMore).toHaveCount(0);
    await expect(section).toContainText(`${member.username} created the task ${memberTitle}`);

    // Person filter: only the member's events.
    await section.getByRole("combobox", { name: "Filter activity by person" }).click();
    await page.getByRole("option", { name: member.username }).click();
    await expect(events).toHaveCount(1);
    await expect(events.first()).toContainText(`${member.username} created the task ${memberTitle}`);

    // Back to everyone.
    await section.getByRole("combobox", { name: "Filter activity by person" }).click();
    await page.getByRole("option", { name: "Everyone" }).click();
    await expect(events.first()).toContainText("changed the due date");
    expect(await events.count()).toBeGreaterThan(1);
  });

  test("a new project opens with its creation event; a person with no changes shows the designed empty state", async ({ page }, testInfo) => {
    const base = apiBase(testInfo);
    const admin = await login(base);
    const s = stamp();
    const tam = await json<{ id: number }>(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: headers(admin.token),
        body: JSON.stringify({
          email: `e2e-act-empty-${s}@solvro.test`,
          username: `e2e-act-empty-${s}`,
          password: PASSWORD,
          role: "TAM",
        }),
      }),
    );
    const customer = await json<{ id: number }>(
      await fetch(`${base}/api/customers`, {
        method: "POST",
        headers: headers(admin.token),
        body: JSON.stringify({ name: `Activity Empty ${s}`, description: "e2e", tamId: tam.id }),
      }),
    );
    const project = await json<{ id: number }>(
      await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: headers(admin.token),
        body: JSON.stringify({ name: `Activity Empty ${s}`, customerId: customer.id, tamId: tam.id, status: "ACTIVE" }),
      }),
    );
    await loginViaUi(page, `e2e-act-empty-${s}@solvro.test`, PASSWORD);
    await page.goto(`/projects/${project.id}/overview`, { waitUntil: "networkidle" });
    const section = page.getByRole("region", { name: "Recent activity" });

    // Creating a project logs its own `created` event (by the admin who made it).
    await expect(section.getByTestId("activity-event")).toHaveCount(1);
    await expect(section.getByTestId("activity-event")).toContainText(`created the project Activity Empty ${s}`);

    // The TAM has changed nothing: filtering to them shows the designed empty state.
    await section.getByRole("combobox", { name: "Filter activity by person" }).click();
    await page.getByRole("option", { name: `e2e-act-empty-${s}` }).click();
    await expect(section.getByText("No activity yet")).toBeVisible();
    await expect(section.getByText("This person has not changed anything in this project yet.")).toBeVisible();
  });
});
