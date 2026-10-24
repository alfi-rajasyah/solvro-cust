import type { Page } from "@playwright/test";
import { expect, loginViaUi, test } from "../fixtures/test";

// Keyboard and screen-reader basics on the project views:
// - a task opens from the keyboard in the List and the Kanban (the title is a
//   button; the Kanban wrapper no longer announces a keyboard drag it cannot do)
// - the task panel takes focus when it opens and gives it back when it closes
//   (hooks/usePanelFocus.ts)
// - icon-font glyphs never leak their ligature word ("drag_indicator",
//   "more_horiz", …) into the accessibility tree.

const activeDescription = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return { tag: "BODY", text: "", inDialog: null as string | null };
    return {
      tag: a.tagName,
      text: (a.textContent ?? "").trim(),
      inDialog: a.closest('[role="dialog"]')?.getAttribute("aria-label") ?? null,
    };
  });

test.describe("keyboard access to tasks (desktop)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "keyboard navigation is a desktop concern");
  });

  test("List: Enter on a task title opens the panel; Escape returns focus to the title", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/list`);
    const title = page.getByRole("button", { name: "Alpha", exact: true }).first();
    await title.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
    await expect.poll(async () => (await activeDescription(page)).inDialog).toBe("Task details");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Task details" })).toHaveCount(0);
    await expect(title).toBeFocused();
  });

  test("Kanban: Tab reaches a card title, Space opens it, Escape returns focus", async ({ page, seededProject }) => {
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/kanban`);
    const card = page.locator('[data-slot="kanban-item"]').filter({ hasText: "Alpha" }).first();
    await expect(card).toBeVisible();

    // The wrapper is not a fake button any more; the title button is the stop.
    await expect(card).not.toHaveAttribute("role", /.+/);
    await expect(card).not.toHaveAttribute("tabindex", /.+/);
    const title = card.getByRole("button", { name: "Alpha", exact: true });
    await title.focus();
    await page.keyboard.press("Space");

    await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
    await expect.poll(async () => (await activeDescription(page)).inDialog).toBe("Task details");

    await page.keyboard.press("Escape");
    await expect(title).toBeFocused();
  });
});

test.describe("icon glyphs stay out of the accessibility tree", () => {
  for (const view of ["list", "kanban", "overview"] as const) {
    test(`project ${view}: no icon ligature word is exposed`, async ({ page, seededProject }) => {
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/${view}`, { waitUntil: "networkidle" });
      const exposed = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".material-symbols-outlined"))
          .filter((el) => el.getClientRects().length > 0)
          .filter((el) => !el.closest('[aria-hidden="true"]'))
          .filter((el) => !el.hasAttribute("role") && !el.hasAttribute("aria-label"))
          // A control's aria-label replaces its content, icon included. A
          // labelled group or dialog does not, so only controls count here.
          .filter(
            (el) =>
              !el.closest(
                ":is(button,a,[role=button],[role=link],[role=menuitem],[role=tab],[role=switch],[role=checkbox]):is([aria-label],[aria-labelledby])",
              ),
          )
          .map((el) => (el.textContent ?? "").trim()),
      );
      expect(exposed).toEqual([]);
    });
  }
});
