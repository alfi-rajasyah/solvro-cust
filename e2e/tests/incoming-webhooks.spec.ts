import { apiBase, expect, loginViaUi, test } from "../fixtures/test";

// Incoming webhook URLs (project Integrations dialog, GitHub #166 Phase 2).
//
// Runs on the worker's seeded project (a stamped project on an "e2e fixture"
// customer), so cleanup-e2e-data.ts removes it and its InboundHook rows
// cascade with the project. The hook name carries "e2e-" and the spec deletes
// its hook at the end; a failed run is covered by the cleanup script.
//
// The senders post through the app's origin with Playwright's request context,
// not the browser, the way a real tool would.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

test("an owner adds an incoming URL, two bodies comment on tasks, and rotating kills the old URL", async ({
  page,
  request,
  seededProject,
}, testInfo) => {
  const { projectId, alpha, beta, token: adminToken } = seededProject;
  const base = apiBase(testInfo);
  const name = `e2e-hook-${stamp()}`;

  await loginViaUi(page);
  await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });

  // 1. Add a URL from the actions menu; the full URL is shown once.
  await page.getByRole("button", { name: "More project actions" }).click();
  await page.getByRole("menuitem", { name: "Integrations" }).click();
  const dialog = page.getByRole("dialog", { name: "Integrations" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add URL" }).click();

  const shown = dialog.getByTestId("inbound-url");
  await expect(shown).toBeVisible();
  const url = ((await shown.textContent()) ?? "").trim();
  const marker = "/api/webhook/in/";
  expect(url).toContain(marker);
  const appUrl = url.slice(0, url.indexOf(marker));
  const token = url.slice(url.indexOf(marker) + marker.length);
  expect(token.length).toBeGreaterThanOrEqual(40);

  await dialog.getByRole("button", { name: "I have saved it" }).click();
  await expect(dialog.getByTestId("inbound-url")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The list shows the token preview and never the URL, also after a reload.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "More project actions" }).click();
  await page.getByRole("menuitem", { name: "Integrations" }).click();
  const row = page.getByRole("dialog", { name: "Integrations" }).getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText(`${token.slice(0, 4)}…`)).toBeVisible();
  await expect(page.getByText(token)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 2. A GitLab-style push and a Solvro JSON body, posted outside the browser.
  const hookUrl = `${base}${marker}${token}`;
  const commitUrl = `https://gitlab.example.com/e2e/repo/-/commit/${stamp()}`;
  const push = await request.post(hookUrl, {
    data: {
      object_kind: "push",
      project: { web_url: "https://gitlab.example.com/e2e/repo" },
      commits: [{ id: stamp(), message: `Fix the login redirect ${appUrl}/tasks/${alpha.id}`, url: commitUrl }],
    },
  });
  expect(push.status()).toBe(200);
  expect(await push.json()).toMatchObject({ linked: 1 });

  const solvro = await request.post(hookUrl, {
    data: { solvro: { task: beta.id, text: `Deployed to staging ${name}` } },
  });
  expect(solvro.status()).toBe(200);
  expect(await solvro.json()).toMatchObject({ linked: 1 });

  // 3. Each task shows its comment with the "via" marker.
  await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, { waitUntil: "networkidle" });
  await expect(page.getByText("Fix the login redirect").first()).toBeVisible();
  await expect(page.getByTestId("comment-source").filter({ hasText: `via ${name}` }).first()).toBeVisible();

  await page.goto(`/projects/${projectId}/list?task=${beta.id}`, { waitUntil: "networkidle" });
  await expect(page.getByText(`Deployed to staging ${name}`).first()).toBeVisible();
  await expect(page.getByTestId("comment-source").filter({ hasText: `via ${name}` }).first()).toBeVisible();

  // 4. Rotate: the old URL answers 404.
  await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "More project actions" }).click();
  await page.getByRole("menuitem", { name: "Integrations" }).click();
  const rotateRow = page.getByRole("dialog", { name: "Integrations" }).getByRole("listitem").filter({ hasText: name });
  await rotateRow.getByRole("button", { name: "Rotate URL" }).click();
  await page.getByRole("dialog", { name: "Rotate URL?" }).getByRole("button", { name: "Rotate URL" }).click();
  await expect(page.getByTestId("inbound-url")).toBeVisible();
  expect(((await page.getByTestId("inbound-url").textContent()) ?? "").trim()).not.toContain(token);

  const old = await request.post(hookUrl, { data: { solvro: { task: beta.id, text: "after rotate" } } });
  expect(old.status()).toBe(404);

  // Tidy up the hook (best effort; the cleanup script covers a failed run).
  const list = await fetch(`${base}/api/projects/${projectId}/inbound-hooks`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (list.ok) {
    const { hooks } = (await list.json()) as { hooks: { id: number; name: string }[] };
    for (const h of hooks.filter((x) => x.name === name)) {
      await fetch(`${base}/api/projects/${projectId}/inbound-hooks/${h.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
  }
});
