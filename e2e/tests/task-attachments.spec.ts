import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// Task attachments (docs/archive/plans/task-attachments.md): the Attachments section on
// the task page. Upload one small file, see its row, download it under its own
// name, delete it; a disallowed extension is refused with a message.
//
// Not covered here: the read-only view. It needs a user whose role has
// project:read without task:write, plus a project they can see, and the fixtures
// have neither; the Vitest suite for TaskAttachments covers it.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

test.describe("task attachments", () => {
  test("upload, download and delete a file", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Attach ${id}` });
    const fileName = `e2e-notes-${id}.txt`;

    await loginViaUi(page);
    await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });

    const section = page.getByRole("region", { name: /^Attachments/ });
    await expect(section.getByText("No files yet.")).toBeVisible();
    await expect(section.getByText(/per file/)).toBeVisible();

    await section.getByTestId("attachment-input").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("hello from the e2e suite\n"),
    });
    const downloadButton = section.getByRole("button", { name: `Download ${fileName}` });
    await expect(downloadButton).toBeVisible();
    await expect(section.getByText(/^25 B/)).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
    expect(download.suggestedFilename()).toBe(fileName);

    await section.getByRole("button", { name: `Delete ${fileName}` }).click();
    await page.getByRole("button", { name: "Delete file" }).click();
    await expect(downloadButton).toHaveCount(0);
    await expect(section.getByText("No files yet.")).toBeVisible();
  });

  test("a disallowed file type shows an error and can be dismissed", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Attach type ${id}` });

    await loginViaUi(page);
    await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });

    const section = page.getByRole("region", { name: /^Attachments/ });
    await section.getByTestId("attachment-input").setInputFiles({
      name: `e2e-run-${id}.exe`,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ"),
    });
    const alert = section.getByRole("alert");
    await expect(alert).toContainText(`e2e-run-${id}.exe`);
    await expect(alert).toContainText(/not allowed/i);
    await alert.getByRole("button", { name: /^Dismiss error/ }).click();
    await expect(alert).toHaveCount(0);
  });
});
