import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { createTask } from "../fixtures/seed";

// Task attachments (docs/archive/plans/task-attachments.md): the Attachments section on
// the task page. Upload one small file, see its row, download it under its own
// name, delete it; a disallowed extension is refused with a message, in the
// browser and by the server. A project member with the built-in STAKEHOLDER role
// (project:read, no task:write) can download but not attach or delete.

const READ_ONLY_PASSWORD = "AttachRead1234!";

/** Uploads one file through the API, as the client does (multipart field "file"). */
function upload(base: string, token: string, taskId: number, name: string, body: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([body], { type: "application/octet-stream" }), name);
  return fetch(`${base}/api/tasks/${taskId}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.status} ${res.url}: ${await res.text()}`);
  return res;
}

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

  test("the server refuses a disallowed file type with 415", async ({ seededProject }, testInfo) => {
    // The browser refuses the type before sending, so the server's own check is
    // reached only by a direct request.
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const id = stamp();
    const task = await createTask(base, token, projectId, { title: `Attach 415 ${id}` });

    const res = await upload(base, token, task.id, `e2e-run-${id}.exe`, "MZ");
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe("attachment_type_not_allowed");
  });

  test("a read-only member can download but not attach or delete", async ({ page, seededProject }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const id = stamp();
    const username = `e2e-att-ro-${id}`;
    const email = `${username}@solvro.test`;
    const reader = (await (
      await ok(
        await fetch(`${base}/api/admin/users`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ email, username, password: READ_ONLY_PASSWORD, role: "STAKEHOLDER" }),
        }),
      )
    ).json()) as { id: number };
    await ok(
      await fetch(`${base}/api/projects/${projectId}/members`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ userId: reader.id }),
      }),
    );
    const task = await createTask(base, token, projectId, { title: `Attach read-only ${id}` });
    const fileName = `e2e-read-${id}.txt`;
    await ok(await upload(base, token, task.id, fileName, "read me\n"));

    await loginViaUi(page, email, READ_ONLY_PASSWORD);
    await page.goto(`/tasks/${task.id}`, { waitUntil: "networkidle" });

    const section = page.getByRole("region", { name: /^Attachments/ });
    const downloadButton = section.getByRole("button", { name: `Download ${fileName}` });
    await expect(downloadButton).toBeVisible();
    await expect(section.getByRole("button", { name: `Delete ${fileName}` })).toHaveCount(0);
    await expect(section.getByRole("button", { name: /Attach files/ })).toHaveCount(0);
    await expect(section.getByTestId("attachment-input")).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
    expect(download.suggestedFilename()).toBe(fileName);

    // The server enforces the same rule.
    const readerToken = (await (
      await ok(
        await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: READ_ONLY_PASSWORD }),
        }),
      )
    ).json()) as { token: string };
    const refused = await upload(base, readerToken.token, task.id, `e2e-ro-${id}.txt`, "no");
    expect(refused.status).toBe(403);
  });
});
