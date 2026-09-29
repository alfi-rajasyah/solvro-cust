import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { getTasks } from "../fixtures/seed";

// Regression for GH #56: LabelPicker used to render a <form> nested inside
// TaskFormModal's #task-form. React replays the bubbling submit up the fiber
// tree, so clicking "Add" (or pressing Enter) also submitted the task form —
// prematurely creating the task and unmounting the drawer, destroying every
// in-progress field. The label-create action must be form-free.

test.describe("task drawer label creation — desktop", () => {
  test.beforeEach(async () => {
    test.skip(
      test.info().project.name !== "desktop",
      "List-view add-task flow is exercised on desktop",
    );
  });

  test("adding a label keeps the drawer open, the draft intact, and creates no task", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    // Stamped names so a Playwright retry against the worker-cached fixture
    // doesn't collide with the project-scoped unique label name.
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const labelName = `Regress ${stamp}`;
    const draftTitle = `Draft task ${stamp}`;

    const tasksBefore = await getTasks(base, token, projectId);

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    // getByRole with a $-anchored regex: the button's material-symbol icon span
    // ("add" ligature) sits directly adjacent to the "Add task" text node with
    // no separating whitespace in the DOM (JSX strips the line-break-only text
    // between them), so `getByText("Add task", { exact: true })` never matches
    // (textContent is "addAdd task", not "Add task") even though the computed
    // accessible name does insert a space ("add Add task"). Anchoring the
    // accessible-name regex at the end avoids both pitfalls and still excludes
    // the per-section "Add task…" row buttons (which end in "…", not "task").
    await page.getByRole("button", { name: /Add task$/ }).click();

    const title = page.getByPlaceholder("Task title");
    await expect(title).toBeVisible();
    await title.fill(draftTitle);

    await page.getByRole("button", { name: "Add label" }).click();
    await page.getByPlaceholder("Label name").fill(labelName);
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // New label chip appears in the picker…
    await expect(page.getByText(labelName)).toBeVisible();
    // …the drawer is still open with the draft intact…
    await expect(title).toHaveValue(draftTitle);
    // …and the label submit did NOT silently create the task.
    const tasksAfter = await getTasks(base, token, projectId);
    expect(tasksAfter.length).toBe(tasksBefore.length);

    // Enter in the label-name input must not submit the task form either.
    await page.getByRole("button", { name: "Add label" }).click();
    await page.getByPlaceholder("Label name").fill(`${labelName} B`);
    await page.getByPlaceholder("Label name").press("Enter");
    await expect(page.getByText(`${labelName} B`)).toBeVisible();
    await expect(title).toHaveValue(draftTitle);
    expect((await getTasks(base, token, projectId)).length).toBe(tasksBefore.length);

    // Closing the loop: a REAL submit (the "Create task" button, not the
    // label picker) must still create exactly one task, and it must carry
    // both labels created above. This pins the other half of the fix —
    // LabelPicker's onChange auto-select and TaskFormModal's reset-effect
    // dep narrowing both have to hold across the two label-create round
    // trips, or labelIds/title would have been reset to empty/"" before
    // this submit fires.
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(title).toBeHidden();

    const tasksFinal = await getTasks(base, token, projectId);
    expect(tasksFinal.length).toBe(tasksBefore.length + 1);
    const created = tasksFinal.find((t) => t.title === draftTitle);
    expect(created).toBeTruthy();
    const createdLabelNames = (
      (created?.labels as Array<{ name: string }> | undefined) ?? []
    ).map((l) => l.name);
    expect(createdLabelNames).toContain(labelName);
    expect(createdLabelNames).toContain(`${labelName} B`);
  });
});
