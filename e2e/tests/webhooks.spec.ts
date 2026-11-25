import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { login } from "../fixtures/seed";

// Outgoing webhooks (Settings > Integrations > Webhooks, GitHub #166).
//
// Each test gets its own throwaway @solvro.test user, so "empty state" is a
// fact, not a hope: the shared sign-in account may already own webhooks. The
// user carries the e2e marker, so cleanup-e2e-data.ts removes it, and the
// Webhook rows cascade with their owner (schema: Webhook.owner onDelete
// Cascade). Webhook names also start with "e2e-" for anyone reading the DB.
//
// "Send test" is deliberately not exercised: it needs a reachable target.
// The save-time address check resolves example.com over DNS, so the backend
// container needs DNS for the create steps to pass.

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

const PASSWORD = "WhTest1234!";

async function createUser(
  base: string,
  adminToken: string,
  role: string,
): Promise<{ id: number; email: string }> {
  const s = stamp();
  const email = `e2e-wh-${role.toLowerCase()}-${s}@solvro.test`;
  const user = await json<{ id: number }>(
    await fetch(`${base}/api/admin/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, username: `e2e-wh-${role.toLowerCase()}-${s}`, password: PASSWORD, role }),
    }),
  );
  return { id: user.id, email };
}

test.describe("Webhooks settings", () => {
  const createdUserIds: number[] = [];
  let adminToken = "";
  let base = "";

  test.beforeAll(async ({}, testInfo) => {
    base = apiBase(testInfo);
    adminToken = (await login(base)).token;
  });

  // Best effort: a user with no projects can be deleted, and its webhooks go
  // with it. A failed run skips this, and the e2e cleanup script covers that.
  test.afterAll(async () => {
    for (const id of createdUserIds) {
      await fetch(`${base}/api/admin/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
  });

  test("create, hide the secret for good, disable, enable and delete a Standard webhook", async ({ page }) => {
    const user = await createUser(base, adminToken, "TAM");
    createdUserIds.push(user.id);
    const name = `e2e-hook-${stamp()}`;

    await loginViaUi(page, user.email, PASSWORD);
    await page.goto("/settings?tab=integrations");

    const section = page.getByRole("region", { name: "Webhooks" });
    await expect(section).toBeVisible();
    await expect(section.getByText("No webhooks yet")).toBeVisible();

    await section.getByRole("button", { name: "Add webhook" }).click();
    const form = page.getByRole("dialog", { name: "New webhook" });
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("URL").fill("https://example.com/solvro-e2e-hook");
    await form.getByRole("checkbox", { name: "Task created" }).check();
    await form.getByRole("checkbox", { name: "Comment added" }).check();
    await form.getByRole("button", { name: "Create webhook" }).click();

    // The secret is on screen exactly once.
    const secretDialog = page.getByRole("dialog", { name: "Webhook created" });
    const secret = secretDialog.getByTestId("webhook-secret");
    await expect(secret).toBeVisible();
    expect(((await secret.textContent()) ?? "").startsWith("whsec_")).toBe(true);
    const secretText = (await secret.textContent()) ?? "";
    await secretDialog.getByRole("button", { name: "I have saved it" }).click();
    await expect(secretDialog).toBeHidden();
    await expect(page.getByTestId("webhook-secret")).toHaveCount(0);
    await expect(page.getByText(secretText)).toHaveCount(0);

    // The row shows the host, never the full URL.
    const row = section.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText("example.com", { exact: true })).toBeVisible();
    await expect(row).not.toContainText("solvro-e2e-hook");
    await expect(row).not.toContainText("https://");
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Rotate secret" })).toBeVisible();

    // A reload does not bring the secret back.
    await page.reload();
    await expect(section.getByRole("listitem").filter({ hasText: name })).toBeVisible();
    await expect(page.getByText(secretText)).toHaveCount(0);

    // Disable, then enable again.
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Enable" }).click();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    // Delete behind the confirm, back to the empty state.
    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog", { name: "Delete webhook?" }).getByRole("button", { name: "Delete webhook" }).click();
    await expect(section.getByText("No webhooks yet")).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
  });

  test("a Google Chat webhook has no signing secret to rotate", async ({ page }) => {
    const user = await createUser(base, adminToken, "TAM");
    createdUserIds.push(user.id);
    const name = `e2e-chat-${stamp()}`;

    await loginViaUi(page, user.email, PASSWORD);
    await page.goto("/settings?tab=integrations");
    const section = page.getByRole("region", { name: "Webhooks" });

    await section.getByRole("button", { name: "Add webhook" }).click();
    const form = page.getByRole("dialog", { name: "New webhook" });
    await form.getByLabel("Name").fill(name);
    await form.getByRole("radio", { name: /Google Chat/ }).check();
    await form.getByLabel("URL").fill("https://chat.googleapis.com/v1/spaces/e2e/messages?key=e2e&token=e2e");
    await form.getByRole("checkbox", { name: "Task created" }).check();
    await form.getByRole("button", { name: "Create webhook" }).click();

    // No secret for Google Chat, so no secret dialog: the row appears directly.
    const row = section.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText("chat.googleapis.com", { exact: true })).toBeVisible();
    await expect(row).not.toContainText("token=");
    await expect(row.getByRole("button", { name: "Disable" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Rotate secret" })).toHaveCount(0);
    await expect(page.getByTestId("webhook-secret")).toHaveCount(0);
  });

  test("a user without webhook:manage gets 403 from the API and no Webhooks section", async ({ page }) => {
    const user = await createUser(base, adminToken, "PENDING");
    createdUserIds.push(user.id);

    const { token } = await login(base, user.email, PASSWORD);
    const res = await fetch(`${base}/api/webhooks`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);

    await loginViaUi(page, user.email, PASSWORD);
    await page.goto("/settings?tab=integrations");
    await expect(page.getByRole("heading", { name: "Settings" }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Webhooks" })).toHaveCount(0);
  });
});
