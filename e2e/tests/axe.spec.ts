import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, loginViaUi, test } from "../fixtures/test";

// Automated accessibility check on the main pages (WCAG 2.1 A/AA plus axe's
// best practices), in the light and the dark theme, on desktop and mobile. It
// guards what is fixed today; known gaps are excluded explicitly and are
// listed in docs/ISSUES.md:
// - region, landmark-unique, heading-order: the page
//   landmark and heading structure is not done yet.
// - contrast of `bg-primary/10` and `bg-primary/15` chips with `text-primary`
//   text (4.2–4.5:1 over tinted surfaces), waiting on the brand colour
//   decision. Only the contrast rule skips them; every other rule still
//   checks them.
//
// Table rows after the tenth are skipped: they repeat the same markup, and
// the pages list whatever the database holds (hundreds of users or projects
// on a long-lived dev database), which would make the scan slow and
// dependent on earlier specs.

const KNOWN_GAP_RULES = ["region", "landmark-unique", "heading-order"];
const CONTRAST_GAP = ":is(.bg-primary\\/10, .bg-primary\\/15).text-primary";
const REPEATED_ROWS = "tbody tr:nth-child(n+11)";

async function violations(page: Page) {
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
  // Every rule but contrast, on the whole page.
  const all = await new AxeBuilder({ page })
    .withTags(tags)
    .disableRules([...KNOWN_GAP_RULES, "color-contrast"])
    .exclude(REPEATED_ROWS)
    .analyze();
  // Contrast alone, without the known chips.
  const contrast = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .exclude(CONTRAST_GAP)
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
    test.use({ colorScheme });

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
  });
}
