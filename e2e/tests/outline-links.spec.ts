import type { Page, TestInfo } from "@playwright/test";
import { test, expect, loginViaUi, apiBase } from "../fixtures/test";

// Outline links (docs/archive/plans/outline-integration.md, Phase A): the
// admin sets the deployment's Outline address (Admin > Outline) and the
// sidebar shows an external "Outline" link; a project and a customer can each
// carry their own link, shown as a header button. Links are plain anchors that
// open in a new tab; `javascript:` is refused inline by the form.
//
// The base URL is one global setting, so the file runs serially and always
// clears it again. Serialize runs with other Playwright users of this stack:
//   flock /tmp/solvro-e2e.lock npx playwright test tests/outline-links.spec.ts

test.describe.configure({ mode: "serial" });

const BASE_URL = "https://docs.example.test";
const PROJECT_URL = "https://docs.example.test/doc/project-plan-abc123";
const CUSTOMER_URL = "https://docs.example.test/collection/customer-xyz789";

async function api(
  testInfo: TestInfo,
  token: string,
  path: string,
  method: "PATCH",
  body: unknown,
): Promise<void> {
  const res = await fetch(`${apiBase(testInfo)}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
}

/** Opens the phone drawer; a no-op on desktop, where the rail is always there. */
async function openNavigationOnMobile(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
}

const sidebarOutlineLink = (page: Page) => page.getByTestId("sidebar-outline-link");

test.describe("Outline links", () => {
  test.afterAll(async ({ seededProject }, testInfo) => {
    // Leave the stack as found: no base URL, no project/customer links.
    await api(testInfo, seededProject.token, "/admin/settings/outline", "PATCH", { baseUrl: "" });
    await api(testInfo, seededProject.token, `/projects/${seededProject.projectId}`, "PATCH", {
      outlineUrl: "",
    });
    await api(testInfo, seededProject.token, `/customers/${seededProject.customerId}`, "PATCH", {
      outlineUrl: "",
    });
  });

  test("admin sets the address, the sidebar link appears, and clearing removes it", async ({
    page,
  }, testInfo) => {
    await loginViaUi(page);
    await page.goto("/admin", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await expect(page.getByText("Outline workspace")).toBeVisible();
    await expect(page.getByText("Not set", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Set address" }).click();
    const dialog = page.getByRole("dialog", { name: "Outline address" });
    // A script URL is refused inline; the dialog stays open.
    await dialog.locator('input[name="baseUrl"]').fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText("http://");
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="baseUrl"]').fill(` ${BASE_URL}/ `);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Linked", { exact: true })).toBeVisible();
    await expect(page.getByTestId("outline-admin-link")).toHaveAttribute("href", BASE_URL);

    // Every user's sidebar now carries the external link.
    await page.goto("/overview", { waitUntil: "networkidle" });
    await openNavigationOnMobile(page, testInfo);
    const link = sidebarOutlineLink(page);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", BASE_URL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toContainText("(opens in a new tab)");

    // Clear it: the sidebar item goes away.
    await page.goto("/admin", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("dialog", { name: "Outline address" }).getByRole("button", { name: "Remove link" }).click();
    // Removing the link for everyone asks first; Cancel keeps it.
    const confirm = page.getByRole("dialog", { name: "Remove Outline link" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await page.getByRole("dialog", { name: "Outline address" }).getByRole("button", { name: "Remove link" }).click();
    await page.getByRole("dialog", { name: "Remove Outline link" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Not set", { exact: true })).toBeVisible();

    await page.goto("/overview", { waitUntil: "networkidle" });
    await openNavigationOnMobile(page, testInfo);
    await expect(sidebarOutlineLink(page)).toHaveCount(0);
  });

  test("a project link set in the form shows as a header link; javascript: is rejected", async ({
    page,
    seededProject,
  }, testInfo) => {
    const mobile = testInfo.project.name === "mobile";
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-link")).toHaveCount(0);

    // Edit lives in the ⋯ menu on phones.
    async function openEditForm() {
      if (mobile) {
        await page.getByRole("button", { name: "More project actions" }).click();
        await page.getByRole("menuitem", { name: "Edit project" }).click();
      } else {
        await page.getByRole("button", { name: /\bEdit$/ }).click();
      }
      return page.getByRole("dialog", { name: "Edit project" });
    }

    let dialog = await openEditForm();
    const field = dialog.locator('input[name="outlineUrl"]');
    await field.fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByText("Enter a full address starting with http:// or https://.")).toBeVisible();
    await expect(dialog).toBeVisible();

    await field.fill(`  ${PROJECT_URL}  `);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();

    if (mobile) {
      await page.getByRole("button", { name: "More project actions" }).click();
      const item = page.getByRole("menuitem", { name: /Open in Outline/ });
      await expect(item).toHaveAttribute("href", PROJECT_URL);
      await expect(item).toHaveAttribute("target", "_blank");
      await page.keyboard.press("Escape");
    } else {
      const button = page.getByTestId("outline-link");
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("href", PROJECT_URL);
      await expect(button).toHaveAttribute("target", "_blank");
      await expect(button).toHaveAttribute("rel", /noopener/);
    }

    // The saved value is what the server stored (trimmed), and clearing removes the button.
    dialog = await openEditForm();
    await expect(dialog.locator('input[name="outlineUrl"]')).toHaveValue(PROJECT_URL);
    await dialog.locator('input[name="outlineUrl"]').fill("");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    if (mobile) {
      await page.getByRole("button", { name: "More project actions" }).click();
      await expect(page.getByRole("menuitem", { name: /Open in Outline/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } else {
      await expect(page.getByTestId("outline-link")).toHaveCount(0);
    }
  });

  test("a customer link set in the form shows on the customer header; javascript: is rejected", async ({
    page,
    seededProject,
  }) => {
    await loginViaUi(page);
    await page.goto(`/customers/${seededProject.customerId}`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-link")).toHaveCount(0);

    await page.getByRole("button", { name: /\bEdit$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit customer" });
    const field = dialog.locator('input[name="outlineUrl"]');
    await field.fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByText("Enter a full address starting with http:// or https://.")).toBeVisible();
    await expect(dialog).toBeVisible();

    await field.fill(CUSTOMER_URL);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();

    const button = page.getByTestId("outline-link");
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("href", CUSTOMER_URL);
    await expect(button).toHaveAttribute("target", "_blank");

    // The project under this customer does not inherit the link.
    await page.goto(`/projects/${seededProject.projectId}`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-link")).toHaveCount(0);
  });
});
