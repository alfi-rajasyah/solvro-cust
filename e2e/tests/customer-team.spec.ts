import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { login } from "../fixtures/seed";

// Customer team (docs/archive/plans/customer-team.md): an admin opens the Team
// tab of a fresh customer, sees the empty state, adds a user through the
// picker, then removes them after confirming. Stamp-named rows, no cleanup,
// like the other customer specs (users and customers have no delete route
// that works once they are referenced).

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

test.describe("Customer team", () => {
  test("add and remove a team member from the Team tab", async ({ page }, testInfo) => {
    const base = apiBase(testInfo);
    const admin = await login(base);
    const H = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
    const s = stamp();
    const username = `e2e-team-${s}`;

    await json(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          email: `${username}@solvro.test`,
          username,
          password: "TeamTest1234!",
          role: "TAM",
        }),
      }),
    );
    const customer = await json<{ id: number }>(
      await fetch(`${base}/api/customers`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ name: `Team Customer ${s}`, description: "e2e customer-team fixture" }),
      }),
    );

    await loginViaUi(page);
    await page.goto(`/customers/${customer.id}?tab=team`, { waitUntil: "networkidle" });

    const team = page.getByTestId("customer-team");
    await expect(team).toBeVisible();
    await expect(page.getByTestId("customer-team-empty")).toBeVisible();

    await team.getByLabel("Person to add").selectOption({ label: `${username} · ${username}@solvro.test` });
    await team.getByRole("button", { name: "Add", exact: true }).click();
    await expect(team.getByText(username, { exact: true })).toBeVisible();
    await expect(team.getByText(/Added by/)).toBeVisible();

    await team.getByLabel(`Remove ${username}`).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove from team" }).click();
    await expect(team.getByText(username, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("customer-team-empty")).toBeVisible();
  });
});
