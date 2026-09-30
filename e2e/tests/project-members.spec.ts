import { type Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { login } from "../fixtures/seed";

// Project members (docs/archive/plans/collaboration-and-sharing.md, phase 2:
// C1 members UI, C2 assignee notice, L1 blocked-link text). The admin API
// creates a TAM who owns a fresh project plus two more TAM users; the specs
// then drive the UI as the owner and (for the sharing flow) as a second user
// in a separate browser context.
//
// Like customer-visibility.spec.ts, nothing created here has a cleanup path
// (users that own or belong to projects can't be deleted, projects have no
// DELETE route in the e2e flow) — every run leaves stamped users/projects in
// the shared dev DB.

const PASSWORD = "MembersTest1234!";

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

interface Setup {
  owner: { id: number; email: string; username: string };
  guest: { id: number; email: string; username: string };
  other: { id: number; email: string; username: string };
  projectId: number;
  customerId: number;
  projectName: string;
}

async function setup(base: string): Promise<Setup> {
  const admin = await login(base);
  const H = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
  const s = stamp();

  async function makeUser(tag: string) {
    const username = `e2e-pm-${tag}-${s}`;
    const email = `${username}@solvro.test`;
    const created = await json<{ id: number }>(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ email, username, password: PASSWORD, role: "TAM" }),
      }),
    );
    return { id: created.id, email, username };
  }

  const owner = await makeUser("owner");
  const guest = await makeUser("guest");
  const other = await makeUser("other");

  // Owned by the project's TAM only, so the guest gets no access through the
  // customer either.
  const customer = await json<{ id: number }>(
    await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        name: `PM Customer ${s}`,
        description: "e2e project-members fixture",
        tamId: owner.id,
      }),
    }),
  );
  const projectName = `PM Project ${s}`;
  const project = await json<{ id: number }>(
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        name: projectName,
        description: "e2e project-members fixture",
        customerId: customer.id,
        tamId: owner.id,
        status: "ACTIVE",
      }),
    }),
  );
  return { owner, guest, other, projectId: project.id, customerId: customer.id, projectName };
}

const membersDialog = (page: Page) => page.getByRole("dialog", { name: "Project members" });

async function openMembersDialog(page: Page) {
  await page.getByTestId("project-members-button").click();
  await expect(membersDialog(page)).toBeVisible();
}

test.describe("Project members", () => {
  test("adding a member gives them access; removing them shows the blocked-link text", async (
    { page, browser },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const { owner, guest, projectId, customerId } = await setup(base);
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";

    // --- Owner adds the guest through the Members dialog.
    await loginViaUi(page, owner.email, PASSWORD);
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
    await openMembersDialog(page);
    const dialog = membersDialog(page);
    await dialog.getByLabel("Person to add").selectOption({ label: `${guest.username} · ${guest.email}` });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByTestId("project-members-list")).toContainText(guest.username);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("project-members-button")).toHaveAttribute(
      "aria-label",
      "Project members (2)",
    );

    // --- The guest, in their own browser context, can open the project.
    const guestContext = await browser.newContext({ baseURL });
    const guestPage = await guestContext.newPage();
    try {
      await loginViaUi(guestPage, guest.email, PASSWORD);
      await guestPage.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
      await expect(guestPage.getByTestId("project-members-button")).toBeVisible();
      await expect(guestPage.getByText("This project doesn't exist or isn't shared with you.")).toHaveCount(0);

      // --- Owner removes the guest.
      await openMembersDialog(page);
      await membersDialog(page).getByRole("button", { name: `Remove ${guest.username}` }).click();
      await expect(membersDialog(page).getByTestId("project-members-list")).not.toContainText(
        guest.username,
      );

      // --- The guest's next load shows the blocked-link text (L1).
      await guestPage.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
      await expect(
        guestPage.getByText(
          "This project doesn't exist or isn't shared with you. Ask the project's TAM to add you as a member.",
        ),
      ).toBeVisible();

      // Same for the customer page: its blocked-link text carries no TAM hint.
      await guestPage.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
      await expect(
        guestPage.getByText("This customer doesn't exist or isn't shared with you."),
      ).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test("assigning a task to a non-member shows the notice and adds them to the header", async (
    { page },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const { owner, other, projectId } = await setup(base);
    const draftTitle = `PM task ${stamp()}`;

    await loginViaUi(page, owner.email, PASSWORD);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("project-members-button")).toHaveAttribute(
      "aria-label",
      "Project members (1)",
    );

    await page.getByRole("button", { name: /Add task$/ }).click();
    const drawer = page.getByRole("dialog", { name: "New task" });
    await drawer.getByPlaceholder("Task title").fill(draftTitle);

    // No notice for "Unassigned"; it appears once a non-member is picked.
    const notice = drawer.getByText("Assigning this person also adds them to the project.");
    await expect(notice).toHaveCount(0);
    await drawer
      .locator("select")
      .filter({ has: page.getByRole("option", { name: "Unassigned" }) })
      .selectOption({ label: `${other.username} · TAM` });
    await expect(notice).toBeVisible();

    await drawer.getByRole("button", { name: "Create task" }).click();
    await expect(drawer).toBeHidden();

    // The saved assignment made them a member; the header follows.
    await expect(page.getByTestId("project-members-button")).toHaveAttribute(
      "aria-label",
      "Project members (2)",
    );
    await expect(
      page.getByTestId("project-member-avatars").locator(`[title^="${other.username}"]`),
    ).toBeVisible();
  });

  test("a member who removes themselves is sent to /projects", async ({ page }, testInfo) => {
    const base = apiBase(testInfo);
    const { guest, projectId } = await setup(base);
    const admin = await login(base);
    await json(
      await fetch(`${base}/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: guest.id }),
      }),
    );

    await loginViaUi(page, guest.email, PASSWORD);
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
    await openMembersDialog(page);
    await membersDialog(page).getByRole("button", { name: `Remove ${guest.username}` }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("removing a member with assigned tasks confirms first and unassigns the tasks", async (
    { page },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const { owner, guest, projectId } = await setup(base);
    const admin = await login(base);
    const H = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
    await json(
      await fetch(`${base}/api/projects/${projectId}/members`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ userId: guest.id }),
      }),
    );
    const task = await json<{ id: number }>(
      await fetch(`${base}/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ title: `PM assigned ${stamp()}`, assignedToId: guest.id }),
      }),
    );

    await loginViaUi(page, owner.email, PASSWORD);
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
    await openMembersDialog(page);
    const dialog = membersDialog(page);
    await dialog.getByRole("button", { name: `Remove ${guest.username}` }).click();

    // Nothing is removed until the in-dialog confirmation is accepted.
    await expect(
      dialog.getByText("They are assigned to 1 task. Removing them unassigns those tasks."),
    ).toBeVisible();
    await expect(dialog.getByTestId("project-members-list")).toContainText(guest.username);
    await dialog.getByRole("button", { name: "Remove and unassign" }).click();
    await expect(dialog.getByTestId("project-members-list")).not.toContainText(guest.username);

    // The dialog drops the row optimistically, before the DELETE lands — poll
    // the API rather than reading it once.
    await expect
      .poll(async () => {
        const tasks = await json<{ id: number; assignedToId: number | null }[]>(
          await fetch(`${base}/api/projects/${projectId}/tasks`, { headers: H }),
        );
        return tasks.find((t) => t.id === task.id)?.assignedToId;
      })
      .toBeNull();
  });

  test("a member sees no owner-only controls; the project's TAM does", async (
    { page, browser },
    testInfo,
  ) => {
    test.skip(testInfo.project.name === "mobile", "Header actions differ on phone; desktop covers the rule.");
    const base = apiBase(testInfo);
    const { owner, guest, projectId, customerId } = await setup(base);
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";
    const admin = await login(base);
    await json(
      await fetch(`${base}/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: guest.id }),
      }),
    );

    // Owner: Delete project (menu) and Delete customer (menu) are offered.
    await loginViaUi(page, owner.email, PASSWORD);
    await page.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "More project actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete project" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "More customer actions" })).toBeVisible();

    // Member: can edit, but the customer is locked and nothing offers deletes.
    const ctx = await browser.newContext({ baseURL });
    const memberPage = await ctx.newPage();
    try {
      await loginViaUi(memberPage, guest.email, PASSWORD);
      await memberPage.goto(`/projects/${projectId}/overview`, { waitUntil: "networkidle" });
      await expect(memberPage.getByRole("button", { name: "More project actions" })).toBeHidden();
      await memberPage.getByRole("button", { name: /Edit$/ }).click();
      const customerSelect = memberPage
        .getByRole("dialog")
        .locator("select")
        .filter({ has: memberPage.getByRole("option", { name: "Select customer…" }) });
      await expect(customerSelect).toBeDisabled();
      await memberPage.keyboard.press("Escape");

      await memberPage.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
      await expect(memberPage.getByRole("button", { name: "Copy link" })).toBeVisible();
      await expect(memberPage.getByRole("button", { name: "More customer actions" })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
