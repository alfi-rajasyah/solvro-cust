import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { getTasks } from "../fixtures/seed";

// Coverage for the Epics tab + epic detail panel (docs/archive/plans/epics-spec.md
// §6/§7 T3): inline create, inline rename, "Add story…" from the panel,
// progress recompute when a story goes DONE, and delete keeping the task
// (epicId -> null, per §4's SetNull rule — T6's List chip isn't wired up
// yet, so "no chip" just means the task keeps existing in List).
//
// Runs as one flow (not several independent `test()`s): `seededProject` is
// worker-scoped (one seeded project for this whole file, see fixtures/test.ts),
// so a fresh, uniquely-stamped epic is created once and carried through every
// step, the same "seed once, mutate through a scenario" shape smoke.spec.ts
// and weekly-sync.spec.ts already use for their own single-flow specs.
//
// Every locator that can match both the desktop table row AND the `md:hidden`
// mobile card for the same epic (both stay in the DOM at once — only Tailwind
// visibility classes differ per viewport) is scoped with `:visible`, the
// established idiom for this (see itop-tickets.spec.ts's file header).

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function patchTaskStatus(
  base: string,
  token: string,
  taskId: number,
  status: string,
): Promise<void> {
  const res = await fetch(`${base}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(`PATCH task ${taskId} failed: ${res.status} ${await res.text()}`);
  }
}

test.describe("Epics tab", () => {
  test("create, rename, story progress, and delete keeps the task", async (
    { page, seededProject },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    await loginViaUi(page);

    await page.goto(`/projects/${projectId}/epics`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Empty state, since this project has no epics yet.
    await expect(
      page.getByText("No epics yet. Group this project's tasks into larger deliverables."),
    ).toBeVisible();

    // --- Create ---
    const title = `Epic ${stamp()}`;
    await page.getByRole("button", { name: "Add epic" }).click();
    const createInput = page.getByLabel("New epic title");
    await createInput.fill(title);
    await createInput.press("Enter");

    const titleButton = page.locator("button:visible", { hasText: title });
    await expect(titleButton).toBeVisible();

    // --- Rename ---
    const renamed = `${title} renamed`;
    await page.locator(`button[aria-label="Rename ${title}"]:visible`).click();
    const renameInput = page.locator('input[aria-label="Epic title"]:visible');
    await expect(renameInput).toBeVisible();
    await renameInput.fill(renamed);
    await renameInput.press("Enter");

    const renamedButton = page.locator("button:visible", { hasText: renamed });
    await expect(renamedButton).toBeVisible();

    // --- Open the panel, add a story ---
    await renamedButton.click();
    const panel = page.getByRole("dialog", { name: "Epic details" });
    await expect(panel).toBeVisible();

    const storyTitle = `Story ${stamp()}`;
    const storyInput = panel.getByLabel("Add story");
    await storyInput.fill(storyTitle);
    await storyInput.press("Enter");
    await expect(panel.getByText(storyTitle, { exact: true })).toBeVisible();

    // Deep link: the panel stays open across a reload via `?epic=<id>`.
    expect(new URL(page.url()).searchParams.get("epic")).toBeTruthy();

    // --- Mark the story DONE via the API, then confirm progress recomputes ---
    const tasks = await getTasks(base, token, projectId);
    const story = tasks.find((t) => t.title === storyTitle);
    expect(story, "seeded story task").toBeTruthy();
    await patchTaskStatus(base, token, story!.id, "DONE");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const panelAfterReload = page.getByRole("dialog", { name: "Epic details" });
    await expect(panelAfterReload).toBeVisible();
    await expect(panelAfterReload.getByText("1/1")).toBeVisible();

    await panelAfterReload.getByRole("button", { name: "Close" }).click();
    await expect(
      page.locator('[data-testid="epic-progress-text"]:visible', { hasText: "1/1" }),
    ).toBeVisible();

    // --- Delete: confirm text + task keeps existing afterward ---
    await page.locator(`button[aria-label="Delete ${renamed}"]:visible`).click();
    const confirmDialog = page.getByRole("dialog", { name: "Delete epic" });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText(/Tasks keep their data and lose the epic link/)).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.locator("button:visible", { hasText: renamed })).toHaveCount(0);

    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    // ProjectList renders both a desktop row (list-dnd.spec.ts's
    // `div[class*="grid-cols-"]` shape) and a `md:hidden` mobile card for
    // the same task — only one is actually visible per viewport. Both the
    // desktop row and the mobile card carry `cursor-pointer` and `border-t`
    // (ProjectList.tsx's TaskRow), so this targets the actual row/card
    // element on either project rather than `:visible` alone, which also
    // matches ancestors like <html>/<body> and made the prior assertion
    // vacuous.
    await expect(
      page
        .locator('div[class*="cursor-pointer"][class*="border-t"]:visible', {
          hasText: storyTitle,
        })
        .first(),
    ).toBeVisible();
  });
});
