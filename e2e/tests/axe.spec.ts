import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, loginViaUi, mockCustomerOrgMapping, test } from "../fixtures/test";

// Automated accessibility check on the main pages (WCAG 2.1 A/AA plus axe's
// best practices), in the light and the dark theme, on desktop and mobile. It
// enforces every rule it runs, including region, landmark-unique and
// heading-order.
//
// Table rows after the tenth are skipped: they repeat the same markup, and
// the pages list whatever the database holds (hundreds of users or projects
// on a long-lived dev database), which would make the scan slow and
// dependent on earlier specs.

const REPEATED_ROWS = "tbody tr:nth-child(n+11)";

async function violations(page: Page) {
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
  // Every rule but contrast, on the whole page.
  const all = await new AxeBuilder({ page })
    .withTags(tags)
    .disableRules(["color-contrast"])
    .exclude(REPEATED_ROWS)
    .analyze();
  // Contrast alone.
  const contrast = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .exclude(REPEATED_ROWS)
    .analyze();
  return [...all.violations, ...contrast.violations].map((v) => ({
    rule: v.id,
    impact: v.impact,
    count: v.nodes.length,
    first: v.nodes[0]?.target.join(" "),
  }));
}

async function settle(page: Page) {
  // Lazily loaded pages and their skeletons (role="status" aria-busy) gone.
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe accessibility scan (${colorScheme} theme)`, () => {
    test.use({ colorScheme, serviceWorkers: "block" });

    test("main pages and every Admin tab have no axe violations", async ({ page, seededProject }) => {
      test.setTimeout(240_000);
      await loginViaUi(page);
      const p = seededProject.projectId;
      const paths = [
        "/overview",
        "/projects",
        `/projects/${p}/overview`,
        `/projects/${p}/list`,
        `/projects/${p}/kanban`,
        `/projects/${p}/epics`,
        `/projects/${p}/risks`,
        "/customers",
        "/tasks",
        "/settings",
        "/help",
      ];
      const found: Record<string, unknown> = {};
      for (const path of paths) {
        await page.goto(path, { waitUntil: "networkidle" });
        await settle(page);
        const v = await violations(page);
        if (v.length > 0) found[path] = v;
      }

      // Admin keeps its tabs in local state: open each one.
      await page.goto("/admin", { waitUntil: "networkidle" });
      for (const tab of ["Users", "Roles", "Sign-in", "Project Override", "iTop", "Outline"]) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        await page.waitForLoadState("networkidle");
        await settle(page);
        const v = await violations(page);
        if (v.length > 0) found[`/admin (${tab})`] = v;
      }

      expect(found).toEqual({});
    });

    test("task panel with subtasks has no axe violations", async ({ page, seededProject }) => {
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/kanban`, { waitUntil: "networkidle" });
      await settle(page);
      await page.getByText("Alpha", { exact: true }).first().click();
      const panel = page.getByRole("dialog", { name: "Task details" });
      await expect(panel).toBeVisible();
      // The seeded task carries two subtasks, each with a reorder handle.
      await expect(panel.getByRole("button", { name: "Reorder subtask" })).toHaveCount(2);
      await settle(page);
      expect(await violations(page)).toEqual([]);
    });

    test("task panel opened from the Gantt tab has no axe violations", async ({ page, seededProject }) => {
      // No column headings on this tab: the panel's own headings must still
      // follow the page h1 without skipping a level. On a phone the Gantt
      // falls back to the list; the deep link opens the panel either way.
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/gantt?task=${seededProject.alpha.id}`, {
        waitUntil: "networkidle",
      });
      await settle(page);
      const panel = page.getByRole("dialog", { name: "Task details" });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("heading", { name: /^Comments/ })).toBeVisible();
      await settle(page);
      expect(await violations(page)).toEqual([]);
    });

    test("selected toggles (project context, active Filter) use the tint text", async ({ page, seededProject }) => {
      // The selected state pairs the tint-text colour with bg-primary/10; it is
      // off by default, so the page scans never reach it.
      await loginViaUi(page);
      const p = seededProject.projectId;
      for (const view of ["list", "kanban"]) {
        await page.goto(`/projects/${p}/${view}?epicFilter=none`, { waitUntil: "networkidle" });
        await settle(page);
        // The count badge renders only while a filter is on: this is the active trigger.
        await expect(page.getByRole("button", { name: /^Filter\s*1$/ })).toHaveClass(/text-primary-tint-text/);
        expect(await violations(page), `${view} with an active filter`).toEqual([]);
      }
      // The project-context toggle is desktop chrome (hidden below md).
      const toggle = page.getByRole("button", { name: "Show project context" });
      if (await toggle.isVisible()) {
        await toggle.click();
        // The glyph is aria-hidden, so axe skips it: assert the class directly.
        await expect(page.getByRole("button", { name: "Hide project context" })).toHaveClass(/text-primary-tint-text/);
        // The panel slides in over 200ms; scan once it sits inside the viewport.
        const panel = page.getByRole("complementary", { name: "Project context" });
        await expect(panel).toBeVisible();
        await expect
          .poll(async () => {
            const box = await panel.boundingBox();
            return box ? box.x + box.width <= (page.viewportSize()?.width ?? 0) + 1 : false;
          })
          .toBe(true);
        await settle(page);
        expect(await violations(page), "project context panel open").toEqual([]);
      }
    });

    test("project tabs show an inset focus ring from the keyboard", async ({ page, seededProject }) => {
      // The tab bar clips overflow, so the ring is drawn inset (docs/DESIGN.md).
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/overview`, { waitUntil: "networkidle" });
      await settle(page);
      const main = page.getByRole("main");
      const tab = main.getByRole("link", { name: "List", exact: true });
      // Focus the tab before it, then Tab onto it, so :focus-visible applies.
      await main.getByRole("link", { name: "Overview", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(tab).toBeFocused();
      const shadow = await tab.evaluate((el) => getComputedStyle(el).boxShadow);
      expect(shadow, "inset ring on the focused tab").toMatch(/inset/);
      expect(shadow).toMatch(/rgb\(/);
    });

    test("share dialog has no axe violations", async ({ page, seededProject }) => {
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/overview`, { waitUntil: "networkidle" });
      await settle(page);
      await page.getByRole("button", { name: "Share with a guest" }).click();
      await expect(page.getByRole("heading", { name: "Guest links" })).toBeVisible();
      await settle(page);
      expect(await violations(page)).toEqual([]);
    });

    test("customer Tickets tab (board) has no axe violations", async ({ page, seededProject }) => {
      // iTop is not connected on the QA stack: feed the tab canned responses.
      await page.route("**/api/itop/status", (route) =>
        route.fulfill({
          json: {
            configured: true,
            baseUrl: "https://itop.example.test",
            lastSyncAt: new Date().toISOString(),
            lastSyncOk: true,
            refreshMinutes: 5,
            actionsEnabled: false,
          },
        }),
      );
      await mockCustomerOrgMapping(page);
      await page.route("**/api/itop/customers/*/tickets*", (route) =>
        route.fulfill({
          json: {
            mapped: true,
            orgName: "Northwind Freight Sdn Bhd",
            tickets: [],
            counts: { ongoing: 0, resolvedWeek: 0, mine: 0, incidents: 0, requests: 0 },
            syncedAt: new Date().toISOString(),
          },
        }),
      );
      await loginViaUi(page);
      await page.goto(`/customers/${seededProject.customerId}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Tickets" }).click();
      await page.getByRole("button", { name: "Board", exact: true }).click();
      await expect(page.locator('[data-slot="kanban-column"]').first()).toBeVisible();
      await settle(page);
      expect(await violations(page)).toEqual([]);
    });
  });
}
