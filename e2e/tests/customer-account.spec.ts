import { expect, loginViaUi, test } from "../fixtures/test";

// Customer account page (pages/CustomerDetail.tsx + components/customer/):
// the Overview tab lists the customer's projects with progress and health,
// the header carries the customer name, and no placeholder ("Soon") text or
// tab is left. The seeded fixture makes a fresh single-project customer whose
// six tasks are all still open, so its project reads "0%".

test.describe("Customer account", () => {
  test("lists the customer's projects with progress", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await page.goto(`/customers/${seededProject.customerId}`, { waitUntil: "networkidle" });

    await expect(
      page.getByRole("heading", { level: 1, name: seededProject.customerName }),
    ).toBeVisible();

    const row = page
      .getByRole("row")
      .filter({ has: page.locator(`a[href="/projects/${seededProject.projectId}"]`) });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("progressbar")).toBeVisible();
    await expect(row.getByText(/\d+% · \d+ of \d+/)).toBeVisible();

    // The header's health roll-up counts ACTIVE projects only; the fixture's
    // project is still PLANNING, so it is linked but not counted as active.
    await expect(page.getByTestId("account-health-line")).toContainText("0 active projects");
  });

  test("has no placeholder tabs or 'Soon' sections", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await page.goto(`/customers/${seededProject.customerId}`, { waitUntil: "networkidle" });

    await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Services", exact: true })).toBeVisible();
    await expect(page.getByText("Soon", { exact: true })).toHaveCount(0);
    for (const name of ["Topology", "Organization Structure", "Documents"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
  });
});
