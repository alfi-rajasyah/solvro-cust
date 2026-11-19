import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask, login } from "../fixtures/seed";

// Projects list row menu (pages/Projects.tsx): "Delete project" with the same
// confirm as the project page. Creates its own throwaway project; never touches
// the shared seeded one.

interface Created {
  projectId: number;
  customerId: number;
  token: string;
  base: string;
}

async function createProject(base: string, name: string): Promise<Created> {
  const { token } = await login(base);
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const ok = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new Error(`Setup failed ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  };
  const c = await ok<{ id: number }>(
    await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: `${name} Co`, description: "e2e" }),
    }),
  );
  const p = await ok<{ id: number }>(
    await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name, description: "delete me", customerId: c.id }),
    }),
  );
  await createTask(base, token, p.id, { title: "Doomed task", status: "TODO" });
  return { projectId: p.id, customerId: c.id, token, base };
}

/** Best-effort teardown: the project may already be gone. */
async function cleanup({ base, token, projectId, customerId }: Created): Promise<void> {
  const H = { Authorization: `Bearer ${token}` };
  await fetch(`${base}/api/projects/${projectId}`, { method: "DELETE", headers: H });
  await fetch(`${base}/api/customers/${customerId}`, { method: "DELETE", headers: H });
}

test.describe("Delete project from the Projects list", () => {
  test("row menu confirms with the task count and removes the card", async ({
    page,
  }, testInfo) => {
    const name = `Delete me ${Date.now().toString(36)}`;
    const created = await createProject(apiBase(testInfo), name);
    const id = created.projectId;
    try {

      await loginViaUi(page);
      await page.goto("/projects", { waitUntil: "networkidle" });

      const link = page.locator(`a[href="/projects/${id}"]`);
      await expect(link).toBeVisible();

      // Keyboard order: the card link, then its ⋯ button.
      await link.focus();
      await page.keyboard.press("Tab");
      const menu = page.getByRole("button", { name: `Actions for ${name}` });
      await expect(menu).toBeFocused();

      await menu.click();
      await page.getByRole("menuitem", { name: "Delete project" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(`Delete project "${name}"`);
      await expect(dialog).toContainText("1 task");
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();

      await expect(link).toHaveCount(0);
      await expect(page).toHaveURL(/\/projects$/);
    } finally {
      await cleanup(created);
    }
  });

  test("cancel keeps the project", async ({ page }, testInfo) => {
    const name = `Keep me ${Date.now().toString(36)}`;
    const created = await createProject(apiBase(testInfo), name);
    const id = created.projectId;
    try {
      await loginViaUi(page);
      await page.goto("/projects", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: `Actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Delete project" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await expect(page.locator(`a[href="/projects/${id}"]`)).toBeVisible();
    } finally {
      await cleanup(created);
    }
  });
});
