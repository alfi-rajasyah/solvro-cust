import { type Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createSection, createTask, isoDateOffset, login } from "../fixtures/seed";

// Guest links (docs/archive/plans/collaboration-and-sharing.md, phase 6: L4).
// An owner creates a link in the project header, opens it in a brand-new
// signed-out browser context, and the guest sees phases and milestones only.
// Every "internal" string is seeded with a distinctive stamp so its absence
// from the guest page is a real assertion, not a coincidence.
//
// Like project-members.spec.ts, nothing created here has a cleanup path — each
// run leaves stamped users/projects in the shared dev DB.

const PASSWORD = "GuestLinks1234!";

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
  member: { id: number; email: string; username: string };
  projectId: number;
  projectName: string;
  customerName: string;
  s: string;
  phases: { done: string; active: string };
  milestone: string;
  hidden: string[];
}

async function setup(base: string): Promise<Setup> {
  const admin = await login(base);
  const H = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
  const s = stamp();

  async function makeUser(tag: string) {
    const username = `e2e-gl-${tag}-${s}`;
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
  const member = await makeUser("member");

  const customerName = `GL Customer ${s}`;
  const customer = await json<{ id: number }>(
    await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: customerName, description: "e2e guest-links fixture", tamId: owner.id }),
    }),
  );
  const projectName = `GL Project ${s}`;
  const project = await json<{ id: number }>(
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        name: projectName,
        description: `SECRET-DESC-${s}`,
        customerId: customer.id,
        tamId: owner.id,
        status: "ACTIVE",
      }),
    }),
  );
  await json(
    await fetch(`${base}/api/projects/${project.id}/members`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ userId: member.id }),
    }),
  );

  // Two phases: one finished, one under way; plus a milestone and non-milestone
  // tasks whose titles must never reach a guest.
  const phases = { done: `Discovery ${s}`, active: `Build ${s}` };
  const secTask1 = `SECRET-TASK-A-${s}`;
  const secTask2 = `SECRET-TASK-B-${s}`;
  const milestone = `Go-live ${s}`;
  const discovery = await createSection(base, admin.token, project.id, { name: phases.done });
  const build = await createSection(base, admin.token, project.id, { name: phases.active });
  const t1 = await createTask(base, admin.token, project.id, {
    title: secTask1,
    sectionId: discovery.id,
    status: "DONE",
    startDate: isoDateOffset(-20),
    dueDate: isoDateOffset(-10),
  });
  await createTask(base, admin.token, project.id, {
    title: secTask2,
    sectionId: build.id,
    status: "IN_PROGRESS",
    startDate: isoDateOffset(-5),
    dueDate: isoDateOffset(15),
  });
  await createTask(base, admin.token, project.id, {
    title: milestone,
    sectionId: build.id,
    status: "TODO",
    isMilestone: true,
    dueDate: isoDateOffset(20),
  });

  const noteInternal = `SECRET-NOTE-INTERNAL-${s}`;
  const noteCustomer = `SECRET-NOTE-CUSTOMER-${s}`;
  const risk = `SECRET-RISK-${s}`;
  const comment = `SECRET-COMMENT-${s}`;
  for (const [body, visibility] of [
    [noteInternal, "INTERNAL"],
    [noteCustomer, "CUSTOMER_FACING"],
  ] as const) {
    await json(
      await fetch(`${base}/api/projects/${project.id}/notes`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ body, visibility }),
      }),
    );
  }
  await json(
    await fetch(`${base}/api/projects/${project.id}/risks`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ description: risk }),
    }),
  );
  await json(
    await fetch(`${base}/api/tasks/${t1.id}/comments`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ body: comment }),
    }),
  );

  return {
    owner,
    member,
    projectId: project.id,
    projectName,
    customerName,
    s,
    phases,
    milestone,
    hidden: [
      secTask1,
      secTask2,
      noteInternal,
      noteCustomer,
      risk,
      comment,
      `SECRET-DESC-${s}`,
      owner.username,
      owner.email,
      member.username,
      member.email,
    ],
  };
}

const shareDialog = (page: Page) => page.getByRole("dialog", { name: "Share with a guest" });

async function openShareDialog(page: Page) {
  await page.getByTestId("share-button").click();
  await expect(shareDialog(page)).toBeVisible();
}

test.describe("Guest links", () => {
  test("owner shares a link; the guest sees phases and milestones only; revoking closes it", async (
    { page, context, browser },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";
    const fx = await setup(base);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL).origin });

    // --- Owner creates a labelled link and copies it.
    await loginViaUi(page, fx.owner.email, PASSWORD);
    await page.goto(`/projects/${fx.projectId}/overview`, { waitUntil: "networkidle" });
    await openShareDialog(page);
    const dialog = shareDialog(page);
    await dialog.getByLabel("Label (optional)").fill("For e2e guest");
    await dialog.getByLabel("Expires after").selectOption({ label: "7 days" });
    await dialog.getByRole("button", { name: "Create link" }).click();

    const panel = dialog.getByTestId("share-new-link");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("You won't see this link again — copy it now.");
    const shownUrl = await panel.getByTestId("share-new-link-url").inputValue();
    expect(shownUrl).toMatch(/\/share\/[A-Za-z0-9_-]{20,}$/);
    expect(shownUrl.startsWith(new URL(baseURL).origin)).toBe(true);
    await panel.getByRole("button", { name: "Copy link" }).click();
    await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(shownUrl);

    // The list shows it as Active; the token itself is not in the list.
    const row = dialog.getByTestId("share-link-row").filter({ hasText: "For e2e guest" });
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Never used");
    await expect(row).toContainText(`Created by ${fx.owner.username}`);
    await expect(row).not.toContainText(shownUrl.split("/share/")[1]);

    // --- A brand-new signed-out context opens the copied link.
    const guestContext = await browser.newContext({ baseURL });
    const guest = await guestContext.newPage();
    try {
      // The API response itself (not just the rendered page) holds no secrets.
      const apiResponse = guest.waitForResponse((r) => r.url().includes("/api/public/share/"));
      await guest.goto(copied, { waitUntil: "networkidle" });
      const publicRes = await apiResponse;
      expect(publicRes.status()).toBe(200);
      const publicBody = await publicRes.text();
      for (const secret of fx.hidden) {
        expect(publicBody, `public API leaked ${secret}`).not.toContain(secret);
      }
      await expect(guest).toHaveURL(/\/share\//);
      await expect(guest.getByTestId("guest-project-name")).toHaveText(fx.projectName);
      await expect(guest.getByTestId("guest-customer")).toHaveText(fx.customerName);

      const phases = guest.getByTestId("guest-phase");
      await expect(phases).toHaveCount(2);
      await expect(phases.nth(0)).toContainText(fx.phases.done);
      await expect(phases.nth(0)).toContainText("Done");
      await expect(phases.nth(1)).toContainText(fx.phases.active);
      await expect(phases.nth(1)).toContainText("In progress");

      const milestones = guest.getByTestId("guest-milestone");
      await expect(milestones).toHaveCount(1);
      await expect(milestones.first()).toContainText(fx.milestone);
      await expect(guest.getByText(/Updated .* ago|Updated just now/)).toBeVisible();

      // Nothing internal reaches the page — text or markup.
      const html = await guest.content();
      for (const secret of fx.hidden) {
        expect(html, `guest page leaked ${secret}`).not.toContain(secret);
      }
      // No app chrome, no sign-in redirect, and the tab is kept out of search.
      await expect(guest.getByRole("navigation")).toHaveCount(0);
      await expect(guest.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
      const overflow = await guest.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // --- The same link works for a signed-in visitor (no redirect either).
      // ...and its public request carries no Authorization header, although
      // this browser holds the owner's token.
      const publicRequest = page.waitForRequest((r) => r.url().includes("/api/public/share/"));
      await page.goto(copied, { waitUntil: "networkidle" });
      const sent = await (await publicRequest).allHeaders();
      expect(sent["authorization"]).toBeUndefined();
      await expect(page).toHaveURL(/\/share\//);
      await expect(page.getByTestId("guest-project-name")).toHaveText(fx.projectName);

      // --- Owner revokes it (in-dialog confirmation, no browser dialog).
      await page.goto(`/projects/${fx.projectId}/overview`, { waitUntil: "networkidle" });
      await openShareDialog(page);
      const listed = shareDialog(page).getByTestId("share-link-row").filter({ hasText: "For e2e guest" });
      await expect(listed).toContainText("Last used");
      // Newly created link: the one-time panel is gone after reopening.
      await expect(shareDialog(page).getByTestId("share-new-link")).toHaveCount(0);
      const inDialog = () =>
        shareDialog(page).evaluate((d) => d.contains(document.activeElement) && document.activeElement !== document.body);
      const revokeButton = listed.getByRole("button", { name: /^Revoke/ });
      const confirm = listed.getByTestId("share-revoke-confirm");
      const cancel = confirm.getByRole("button", { name: "Cancel" });

      // Keyboard path: Enter opens the confirmation and focus moves onto it.
      await revokeButton.focus();
      await page.keyboard.press("Enter");
      await expect(confirm).toBeVisible();
      await expect(cancel).toBeFocused();
      // Cancel with Enter: focus returns to the Revoke button.
      await page.keyboard.press("Enter");
      await expect(confirm).toBeHidden();
      await expect(revokeButton).toBeFocused();
      // Open it again and Tab to "Revoke link"; focus never leaves the dialog.
      await page.keyboard.press("Enter");
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(confirm.getByRole("button", { name: "Revoke link" })).toBeFocused();
      expect(await inDialog()).toBe(true);
      await page.keyboard.press("Enter");
      await expect(listed).toContainText("Revoked");
      await expect(confirm).toBeHidden();
      // The confirm row is gone; focus is still inside the dialog, so Tab stays.
      expect(await inDialog()).toBe(true);
      await page.keyboard.press("Tab");
      expect(await inDialog()).toBe(true);
      await page.keyboard.press("Shift+Tab");
      expect(await inDialog()).toBe(true);
      await expect(listed.getByRole("button", { name: /^Revoke/ })).toHaveCount(0);

      // --- The guest page now shows the unavailable message.
      await guest.reload({ waitUntil: "networkidle" });
      await expect(guest.getByTestId("guest-unavailable")).toContainText(
        "This link has expired or is no longer available",
      );
      await expect(guest.getByTestId("guest-project-name")).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });

  test("a project member without ownership does not see the Share control", async (
    { page, browser },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:8080";
    const fx = await setup(base);

    // The owner sees it.
    await loginViaUi(page, fx.owner.email, PASSWORD);
    await page.goto(`/projects/${fx.projectId}/overview`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("share-button")).toBeVisible();

    // A member (project access through membership only) does not.
    const memberContext = await browser.newContext({ baseURL });
    const memberPage = await memberContext.newPage();
    try {
      await loginViaUi(memberPage, fx.member.email, PASSWORD);
      await memberPage.goto(`/projects/${fx.projectId}/overview`, { waitUntil: "networkidle" });
      await expect(memberPage.getByTestId("project-members-button")).toBeVisible();
      await expect(memberPage.getByTestId("share-button")).toHaveCount(0);
    } finally {
      await memberContext.close();
    }
  });

  test("an unknown link shows the unavailable page without asking to sign in", async ({ page }) => {
    await page.goto("/share/this-token-does-not-exist", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/share\/this-token-does-not-exist$/);
    await expect(page.getByTestId("guest-unavailable")).toContainText(
      "This link has expired or is no longer available",
    );
  });
});
