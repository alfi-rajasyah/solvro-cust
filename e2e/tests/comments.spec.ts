import { test, expect, loginViaUi } from "../fixtures/test";

// Regression for GH #57: comment bodies rendered with whitespace-pre-wrap but
// no break-words, so a long unbroken string (URL, token, keyboard mash)
// overflowed its bubble and painted outside the 380px panel.

test.describe("task panel comments — desktop", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Panel layout asserted at desktop width");
  });

  test("long unbroken comment text wraps inside its bubble", async ({ page, seededProject }) => {
    const { projectId, alpha } = seededProject;
    const long = "W".repeat(300); // no whitespace anywhere — worst case

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, {
      waitUntil: "networkidle",
    });

    const composer = page.getByPlaceholder("Write a comment…");
    await expect(composer).toBeVisible();
    await composer.fill(long);
    await page.getByRole("button", { name: "Send comment" }).click();

    const body = page.getByText(long).first();
    await expect(body).toBeVisible();
    // The paragraph must not overflow its own box…
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    // …nor its bubble (the min-w-0 flex-1 container the header row + paragraph
    // both live in). This is the real containment check: the panel is
    // position:fixed inside an overflow-hidden Shell root, so a
    // document-scrollWidth check would pass even on unfixed code — the
    // overflow paints past the panel edge and never reaches the document.
    expect(
      await body.evaluate((el) => {
        const bubble = el.parentElement!;
        return bubble.scrollWidth - bubble.clientWidth;
      }),
    ).toBeLessThanOrEqual(1);
  });
});
