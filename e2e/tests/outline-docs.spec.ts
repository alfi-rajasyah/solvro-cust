import type { Page, Route } from "@playwright/test";
import { test, expect, loginViaUi } from "../fixtures/test";

// Outline inside Solvro (docs/archive/plans/outline-integration.md, B6): the
// Settings connect card and its OAuth return messages, the Admin › Outline API
// and webhook cards, the Docs tab (project and customer) and the New doc dialog.
// The Outline-facing endpoints are stubbed with Playwright route mocking so the
// UI states are deterministic; the real round trip against a live Outline is
// covered by the backend suite and the live smoke. Serialize with other users
// of the stack:
//   flock /tmp/solvro-e2e.lock npx playwright test tests/outline-docs.spec.ts

const DOCS_BASE = "https://docs.example.test";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Json = Record<string, unknown> | unknown[] | null;
const json = (route: Route, body: Json, status = 200) => route.fulfill({ status, json: body });

interface MeState {
  configured: boolean;
  connected: boolean;
  outlineEmail: string | null;
  expiresAt: string | null;
}

const CONNECTED: MeState = {
  configured: true,
  connected: true,
  outlineEmail: "rina@acme.test",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};
const NOT_CONNECTED: MeState = { configured: true, connected: false, outlineEmail: null, expiresAt: null };

/** The Outline endpoints every user-facing screen reads (config + connection). */
async function mockMe(page: Page, state: { me: MeState; baseUrl?: string | null }) {
  await page.route("**/api/outline/config", (r) => json(r, { baseUrl: state.baseUrl === undefined ? DOCS_BASE : state.baseUrl }));
  await page.route("**/api/outline/me", (r) => {
    if (r.request().method() === "DELETE") {
      state.me = NOT_CONNECTED;
      return r.fulfill({ status: 204 });
    }
    return json(r, state.me as unknown as Json);
  });
}

const node = (id: string, title: string, children: unknown[] = []) => ({
  id,
  title,
  url: `${DOCS_BASE}/doc/${id}`,
  children,
});

const TREE = [
  node("kickoff", "Project kickoff", [node("scope", "Scope & success criteria"), node("map", "Stakeholder map")]),
  node("runbook", "Cut-over runbook"),
];

test.describe("Settings › Outline connect card", () => {
  test("shows the connected account, and Disconnect asks first", async ({ page }) => {
    const state = { me: CONNECTED };
    await mockMe(page, state);
    await loginViaUi(page);
    await page.goto("/settings", { waitUntil: "networkidle" });

    const card = page.getByTestId("outline-connect-card");
    await expect(card.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByTestId("outline-connected-as")).toContainText("rina@acme.test");

    await card.getByRole("button", { name: "Disconnect" }).click();
    const confirm = page.getByRole("dialog", { name: "Disconnect Outline" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(card.getByText("Connected", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog", { name: "Disconnect Outline" }).getByRole("button", { name: "Disconnect" }).click();
    await expect(card.getByRole("button", { name: "Connect Outline" })).toBeVisible();
    await expect(card.getByText("Not connected yet")).toBeVisible();
  });

  test("Connect starts the OAuth round trip and navigates to the authorize URL", async ({ page }) => {
    const state = { me: NOT_CONNECTED };
    await mockMe(page, state);
    // The authorize URL must be on the configured Outline origin; this stand-in
    // "Outline" bounces straight back to Solvro with a refusal, so the return path is exercised too.
    await page.route("**/api/outline/oauth/start", (r) =>
      json(r, { authorizeUrl: `${DOCS_BASE}/oauth/authorize?state=x` }),
    );
    await page.route(`${DOCS_BASE}/oauth/authorize**`, (r) =>
      r.fulfill({
        status: 302,
        headers: { location: new URL("/settings?outline=error&reason=identity_mismatch", page.url()).toString() },
      }),
    );
    await loginViaUi(page);
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Connect Outline" }).click();

    const notice = page.getByTestId("outline-return-notice");
    await expect(notice).toContainText("That Outline account uses a different email than your Solvro account.");
    // The parameters are stripped so a reload does not repeat the message.
    await expect(page).toHaveURL(/\/settings$/);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-return-notice")).toHaveCount(0);
  });

  test("Connect refuses an authorize URL that is not on the configured Outline", async ({ page }) => {
    const state = { me: NOT_CONNECTED };
    await mockMe(page, state);
    await page.route("**/api/outline/oauth/start", (r) =>
      json(r, { authorizeUrl: "https://evil.example/oauth/authorize?state=x" }),
    );
    let leftSolvro = false;
    await page.route("https://evil.example/**", (r) => {
      leftSolvro = true;
      return r.fulfill({ status: 200, body: "no" });
    });
    await loginViaUi(page);
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Connect Outline" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not start the Outline connection" })).toBeVisible();
    expect(leftSolvro).toBe(false);
    await expect(page).toHaveURL(/\/settings/);
  });

  test("no Outline address: the Settings page makes no Outline connection request and shows no card", async ({ page }) => {
    let meCalls = 0;
    await page.route("**/api/outline/config", (r) => json(r, { baseUrl: null }));
    await page.route("**/api/outline/me", (r) => {
      meCalls += 1;
      return json(r, NOT_CONNECTED as unknown as Json);
    });
    await loginViaUi(page);
    await page.goto("/settings", { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-connect-card")).toHaveCount(0);
    expect(meCalls).toBe(0);
  });

  for (const [query, text] of [
    ["outline=connected", "Outline connected."],
    ["outline=cancelled", "Connection cancelled."],
    ["outline=error&reason=already_linked", "already connected to another Solvro user"],
    ["outline=error&reason=state", "expired or was already used"],
    ["outline=error&reason=exchange", "did not accept"],
    ["outline=error&reason=unavailable", "could not reach Outline"],
    ["outline=error&reason=not_configured", "administrator"],
    ["outline=error&reason=%3Cscript%3E", "Could not connect Outline."],
  ] as const) {
    test(`the return message for ?${query}`, async ({ page }) => {
      await mockMe(page, { me: NOT_CONNECTED });
      await loginViaUi(page);
      await page.goto(`/settings?${query}`, { waitUntil: "networkidle" });
      await expect(page.getByTestId("outline-return-notice")).toContainText(text);
      await expect(page).toHaveURL(/\/settings$/);
    });
  }

  test("an install that is not set up for sign-in shows a note instead of a Connect button", async ({ page }) => {
    await mockMe(page, { me: { ...NOT_CONNECTED, configured: false } });
    await loginViaUi(page);
    await page.goto("/settings", { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-not-configured")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Outline" })).toHaveCount(0);
  });

  test("the card is absent while no Outline address is set", async ({ page }) => {
    await mockMe(page, { me: { ...NOT_CONNECTED, configured: false }, baseUrl: null });
    await loginViaUi(page);
    await page.goto("/settings", { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-connect-card")).toHaveCount(0);
  });
});

test.describe("Admin › Outline API access and webhook", () => {
  const base = () => ({
    baseUrl: DOCS_BASE as string | null,
    oauthClientId: null as string | null,
    oauthClientSecretSet: false,
    webhookSecretSet: false,
    lastWebhookAt: null as string | null,
    appUrlConfigured: true,
    appUrlWarning: null as string | null,
    // Both are null while the server has no APP_URL.
    redirectUri: "https://solvro.example.test/api/outline/oauth/callback" as string | null,
    webhookUrl: "https://solvro.example.test/api/webhook/outline" as string | null,
    updatedAt: iso(60_000),
    updatedBy: { id: 1, username: "admin" },
  });

  async function openTab(page: Page, settings: ReturnType<typeof base>, patches: unknown[] = []) {
    await page.route("**/api/admin/settings/outline", (r) => {
      if (r.request().method() === "PATCH") {
        const body = r.request().postDataJSON() as Record<string, unknown>;
        patches.push(body);
        if ("oauthClientId" in body) settings.oauthClientId = body.oauthClientId as string | null;
        if (typeof body.oauthClientSecret === "string") settings.oauthClientSecretSet = true;
        if ("baseUrl" in body) settings.baseUrl = body.baseUrl as string | null;
      }
      return json(r, settings);
    });
    await loginViaUi(page);
    await page.goto("/admin", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await expect(page.getByTestId("outline-api-card")).toBeVisible();
  }

  test("API access: set the client, secret is write-only, redirect URL has a copy button", async ({ page, context }, testInfo) => {
    const settings = base();
    const patches: unknown[] = [];
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await openTab(page, settings, patches);
    const card = page.getByTestId("outline-api-card");

    await expect(card.getByText("Setup incomplete")).toBeVisible();
    await expect(page.getByTestId("outline-secret-state")).toHaveText("· not set");
    await expect(page.getByTestId("outline-redirect-uri")).toHaveText(settings.redirectUri!);
    await card.getByRole("button", { name: "Copy redirect URL" }).click();
    await expect(card.getByText("Copied")).toBeVisible();
    if (testInfo.project.name === "desktop") {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(settings.redirectUri);
    }

    await expect(card.getByRole("button", { name: "Save" })).toBeDisabled();
    await card.getByLabel("Client ID").fill("client-abc");
    await card.getByLabel(/Client secret/).fill("s3cret-value");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("outline-api-saved")).toBeVisible();
    expect(patches).toEqual([{ oauthClientId: "client-abc", oauthClientSecret: "s3cret-value" }]);

    // The secret is cleared from the form and never rendered back.
    await expect(card.getByLabel(/Client secret/)).toHaveValue("");
    await expect(page.getByTestId("outline-secret-state")).toHaveText("· set");
    await expect(page.locator("body")).not.toContainText("s3cret-value");
    await expect(card.getByText("Ready")).toBeVisible();
  });

  test("changing an existing client asks first, and says every user is disconnected", async ({ page }) => {
    const settings = { ...base(), oauthClientId: "old-client", oauthClientSecretSet: true };
    const patches: unknown[] = [];
    await openTab(page, settings, patches);
    const card = page.getByTestId("outline-api-card");
    await expect(card.getByText("Changing the address or client disconnects every user.")).toBeVisible();

    await card.getByLabel("Client ID").fill("new-client");
    await card.getByRole("button", { name: "Save" }).click();
    const confirm = page.getByRole("dialog", { name: "Change the OAuth client?" });
    await expect(confirm).toContainText("disconnects every user");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    expect(patches).toEqual([]);

    await card.getByRole("button", { name: "Save" }).click();
    await page.getByRole("dialog", { name: "Change the OAuth client?" }).getByRole("button", { name: "Change client" }).click();
    await expect(page.getByTestId("outline-api-saved")).toBeVisible();
    expect(patches).toEqual([{ oauthClientId: "new-client" }]);
  });

  test("a secret-only update does not ask for confirmation", async ({ page }) => {
    const settings = { ...base(), oauthClientId: "same", oauthClientSecretSet: true };
    const patches: unknown[] = [];
    await openTab(page, settings, patches);
    const card = page.getByTestId("outline-api-card");
    await card.getByLabel(/Client secret/).fill("rotated");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("outline-api-saved")).toBeVisible();
    expect(patches).toEqual([{ oauthClientSecret: "rotated" }]);
  });

  test("shows the APP_URL notices", async ({ page }) => {
    const settings = { ...base(), appUrlConfigured: false, redirectUri: null, webhookUrl: null };
    await openTab(page, settings);
    await expect(page.getByTestId("outline-app-url-unset")).toContainText("APP_URL");
    await expect(page.getByTestId("outline-redirect-uri")).toHaveCount(0);
    await expect(page.getByTestId("outline-webhook-url")).toHaveCount(0);

    const warned = { ...base(), appUrlWarning: "APP_URL uses http on a non-loopback host. Outline only accepts an https OAuth redirect URI." };
    await page.unroute("**/api/admin/settings/outline");
    await page.route("**/api/admin/settings/outline", (r) => json(r, warned));
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await expect(page.getByTestId("outline-app-url-warning")).toContainText("https OAuth redirect URI");
  });

  test("webhook: generating the secret shows it once, then never again", async ({ page, context }, testInfo) => {
    const settings = base();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    const SECRET = "ab".repeat(32);
    await page.route("**/api/admin/settings/outline/webhook-secret/rotate", (r) => {
      settings.webhookSecretSet = true;
      return json(r, { webhookSecret: SECRET });
    });
    await openTab(page, settings);
    const card = page.getByTestId("outline-webhook-card");
    await expect(card.getByText("Not set up")).toBeVisible();
    await expect(page.getByTestId("outline-webhook-url")).toHaveText(settings.webhookUrl!);
    await expect(page.getByTestId("outline-webhook-secret-state")).toHaveText("Not generated yet");

    await page.getByTestId("outline-rotate-secret").click();
    const dialog = page.getByRole("dialog", { name: "New signing secret" });
    await expect(dialog).toContainText("You won't see it again.");
    await expect(page.getByTestId("outline-new-secret")).toHaveText(SECRET);
    await dialog.getByRole("button", { name: "Copy signing secret" }).click();
    await expect(dialog.getByText("Copied")).toBeVisible();
    if (testInfo.project.name === "desktop") {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SECRET);
    }
    await page.getByTestId("outline-secret-done").click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).not.toContainText(SECRET);
    await expect(page.getByTestId("outline-webhook-secret-state")).toContainText("Stored encrypted");

    // Rotating an existing secret asks first.
    await expect(page.getByTestId("outline-rotate-secret")).toHaveText("Rotate secret");
    await page.getByTestId("outline-rotate-secret").click();
    const confirm = page.getByRole("dialog", { name: "Rotate the signing secret?" });
    await expect(confirm).toContainText("stops working immediately");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "New signing secret" })).toHaveCount(0);
  });

  test("webhook health: recent delivery is fine; none yet and 24 h+ old show the warning", async ({ page }) => {
    const settings = { ...base(), webhookSecretSet: true, lastWebhookAt: iso(2 * 60_000) };
    await openTab(page, settings);
    await expect(page.getByTestId("outline-last-delivery")).toContainText("2 min ago");
    await expect(page.getByTestId("outline-webhook-card").getByText("Receiving")).toBeVisible();
    await expect(page.getByTestId("outline-webhook-warning")).toHaveCount(0);

    for (const [last, text] of [
      [null, "No delivery yet"],
      [iso(3 * 24 * 3_600_000), "No delivery in 24 hours — check the webhook in Outline (Outline turns off webhooks that keep failing)."],
    ] as const) {
      await page.unroute("**/api/admin/settings/outline");
      await page.route("**/api/admin/settings/outline", (r) => json(r, { ...settings, lastWebhookAt: last }));
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Outline", exact: true }).click();
      await expect(page.getByTestId("outline-webhook-warning")).toContainText(text);
    }
  });

  test("changing the Outline address asks first", async ({ page }) => {
    const settings = base();
    const patches: unknown[] = [];
    await openTab(page, settings, patches);
    await page.getByRole("button", { name: "Manage" }).click();
    const dialog = page.getByRole("dialog", { name: "Outline address", exact: true });
    await dialog.locator('input[name="baseUrl"]').fill("https://other.example.test");
    await dialog.getByRole("button", { name: "Save" }).click();
    const confirm = page.getByRole("dialog", { name: "Change the Outline address?" });
    await expect(confirm).toContainText("disconnects every user");
    expect(patches).toEqual([]);
    await confirm.getByRole("button", { name: "Change address" }).click();
    await expect(dialog).toBeHidden();
    expect(patches).toEqual([{ baseUrl: "https://other.example.test" }]);
  });
});

test.describe("Docs tab", () => {
  async function setup(page: Page, docs: Json | ((r: Route) => Promise<void>), opts: { me?: MeState; scope?: "projects" | "customers" } = {}) {
    await mockMe(page, { me: opts.me ?? CONNECTED });
    await page.route(`**/api/${opts.scope ?? "projects"}/*/outline/docs`, async (r) => {
      if (r.request().method() !== "GET") return r.fallback();
      if (typeof docs === "function") return docs(r);
      return json(r, docs);
    });
  }

  const treeResponse = {
    anchor: { kind: "collection", title: "Core Banking Migration", url: `${DOCS_BASE}/collection/core-abc` },
    tree: TREE,
  };

  test("the tab is offered next to the others and lists the tree: expand, collapse, safe new-tab links", async ({ page, seededProject }) => {
    await setup(page, treeResponse);
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/overview`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Docs", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${seededProject.projectId}/docs$`));

    await expect(page.getByTestId("outline-docs-anchor")).toHaveText("Core Banking Migration");
    const rows = page.getByTestId("outline-doc-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Cut-over runbook/ })).toHaveAttribute("href", `${DOCS_BASE}/doc/runbook`);
    await expect(page.getByRole("link", { name: /Cut-over runbook/ })).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: /Cut-over runbook/ })).toHaveAttribute("rel", /noopener/);

    // A disclosure list, not an ARIA tree: no tree roles, and the toggle states what it controls.
    await expect(page.getByRole("tree")).toHaveCount(0);
    await expect(page.getByRole("treeitem")).toHaveCount(0);
    const toggle = page.getByRole("button", { name: "Expand Project kickoff" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByRole("button", { name: "Collapse Project kickoff" })).toHaveAttribute("aria-expanded", "true");
    const controlled = await page.getByRole("button", { name: "Collapse Project kickoff" }).getAttribute("aria-controls");
    expect(controlled).toBeTruthy();
    await expect(page.locator(`ul[id="${controlled}"]`).getByTestId("outline-doc-row")).toHaveCount(2);
    await expect(rows).toHaveCount(4);
    await expect(page.getByRole("link", { name: /Stakeholder map/ })).toBeVisible();
    await page.getByRole("button", { name: "Collapse Project kickoff" }).click();
    await expect(rows).toHaveCount(2);

    // Nothing overflows sideways, phone included.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByRole("link", { name: "Open in Outline" })).toHaveAttribute("href", `${DOCS_BASE}/collection/core-abc`);
  });

  test("saving the project's Outline link refetches the Docs tree", async ({ page, seededProject }, testInfo) => {
    let gets = 0;
    await setup(page, async (r) => {
      gets += 1;
      await json(r, treeResponse);
    });
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-doc-row")).toHaveCount(2);
    const before = gets;

    try {
      if (testInfo.project.name === "mobile") {
        await page.getByRole("button", { name: "More project actions" }).click();
        await page.getByRole("menuitem", { name: "Edit project" }).click();
      } else {
        await page.getByRole("button", { name: /\bEdit$/ }).click();
      }
      const dialog = page.getByRole("dialog", { name: "Edit project" });
      await dialog.locator('input[name="outlineUrl"]').fill(`${DOCS_BASE}/doc/new-link-zzz`);
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => gets).toBeGreaterThan(before);
    } finally {
      await fetch(`${new URL(testInfo.project.use.baseURL ?? "http://localhost:8080").origin}/api/projects/${seededProject.projectId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${seededProject.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ outlineUrl: "" }),
      });
    }
  });

  test("a page link is the root of its own tree and opens expanded", async ({ page, seededProject }) => {
    await setup(page, {
      anchor: { kind: "doc", title: "Project kickoff", url: `${DOCS_BASE}/doc/kickoff` },
      tree: [TREE[0]],
    });
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("outline-doc-row")).toHaveCount(3);
  });

  const stateCases: Array<[string, Json, string]> = [
    ["no link", { anchor: null }, "No Outline link yet"],
    ["outside", { anchor: { outside: true } }, "This link points outside your Outline"],
    ["unsupported", { anchor: { unsupported: true } }, "isn't an Outline page or collection"],
    ["hidden", { anchor: { hidden: true } }, "You can't open this page in Outline"],
    ["empty", { anchor: { kind: "collection", title: "Empty", url: `${DOCS_BASE}/collection/e` }, tree: [] }, "No pages here yet"],
  ];
  for (const [name, body, text] of stateCases) {
    test(`state: ${name}`, async ({ page, seededProject }) => {
      await setup(page, body);
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
      await expect(page.getByText(text)).toBeVisible();
    });
  }

  test("not connected: shows Connect, which starts the OAuth round trip", async ({ page, seededProject }) => {
    await setup(page, (r) => json(r, { error: "Connect your Outline account first.", code: "outline_not_connected" }, 409), { me: NOT_CONNECTED });
    let started = 0;
    await page.route("**/api/outline/oauth/start", (r) => {
      started += 1;
      return json(r, { authorizeUrl: `${DOCS_BASE}/oauth/authorize?state=x` });
    });
    // The configured Outline answers the consent screen with a cancel.
    await page.route(`${DOCS_BASE}/oauth/authorize**`, (r) =>
      r.fulfill({ status: 302, headers: { location: new URL("/settings?outline=cancelled", page.url()).toString() } }),
    );
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
    await expect(page.getByText("Connect your Outline account")).toBeVisible();
    await page.getByTestId("outline-docs-connect").click();
    await expect(page.getByTestId("outline-return-notice")).toContainText("Connection cancelled");
    expect(started).toBe(1);
  });

  test("an expired connection asks to reconnect", async ({ page, seededProject }) => {
    await setup(page, (r) => json(r, { error: "expired", code: "outline_reconnect_required" }, 409));
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
    await expect(page.getByText("Your Outline connection expired")).toBeVisible();
    await expect(page.getByTestId("outline-docs-connect")).toBeVisible();
  });

  test("rate limited: says how long to wait and retries on request", async ({ page, seededProject }) => {
    // Dev StrictMode mounts twice (and aborts the first request), so count by state, not by call.
    let limited = true;
    await setup(page, (r) =>
      limited
        ? json(r, { error: "busy", code: "outline_rate_limited", details: { retryAfter: 12 } }, 429)
        : json(r, treeResponse),
    );
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
    await expect(page.getByText("Outline is busy")).toBeVisible();
    await expect(page.getByText("Try again in 12 s.")).toBeVisible();
    limited = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("outline-doc-row")).toHaveCount(2);
  });

  test("the customer page has a Docs tab too", async ({ page, seededProject }) => {
    await setup(page, treeResponse, { scope: "customers" });
    await loginViaUi(page);
    await page.goto(`/customers/${seededProject.customerId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Docs", exact: true }).click();
    await expect(page.getByTestId("outline-doc-row")).toHaveCount(2);
    await expect(page).toHaveURL(/tab=docs/);
  });

  test("no Docs tab while no Outline address is set", async ({ page, seededProject }) => {
    await mockMe(page, { me: NOT_CONNECTED, baseUrl: null });
    await loginViaUi(page);
    await page.goto(`/projects/${seededProject.projectId}/overview`, { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: "Services", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Docs", exact: true })).toHaveCount(0);
  });

  test.describe("New doc dialog", () => {
    test("template cards, default title, place-under, publish, and Create and open", async ({ page, seededProject }) => {
      await setup(page, treeResponse);
      // Behaves like a real browser: the "noopener" feature makes window.open return
      // null even though the tab opened; otherwise it returns the new window, whose
      // `opener` the app must sever itself.
      await page.addInitScript(() => {
        const w = window as unknown as { __opened: string[]; __lastOpened: { opener: unknown } | null };
        w.__opened = [];
        w.__lastOpened = null;
        window.open = ((u?: string | URL, _target?: string, features?: string) => {
          w.__opened.push(String(u));
          if (features && /noopener/.test(features)) return null;
          w.__lastOpened = { opener: "parent" };
          return w.__lastOpened as unknown as Window;
        }) as typeof window.open;
      });
      await page.route("**/api/outline/templates", (r) =>
        json(r, [
          { id: "11111111-1111-4111-8111-111111111111", title: "Meeting notes" },
          { id: "22222222-2222-4222-8222-222222222222", title: "Runbook" },
        ]),
      );
      const posts: unknown[] = [];
      await page.route(`**/api/projects/${seededProject.projectId}/outline/docs`, async (r) => {
        if (r.request().method() !== "POST") return r.fallback();
        posts.push(r.request().postDataJSON());
        return json(r, { id: "99999999-9999-4999-8999-999999999999", title: "T", url: `${DOCS_BASE}/doc/new-page-abc` }, 201);
      });
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
      await page.getByTestId("new-outline-doc").click();
      const dialog = page.getByRole("dialog", { name: "New Outline doc" });
      await expect(dialog.getByTestId("new-outline-doc-as")).toHaveText("rina@acme.test");
      await expect(dialog.getByLabel("Blank page")).toBeChecked();
      await expect(dialog.getByTestId("new-outline-doc-title")).toHaveValue(/^New page — \d{1,2} \w{3}/);

      // Choosing a template re-titles an untouched title.
      await dialog.getByLabel("Meeting notes").check();
      await expect(dialog.getByTestId("new-outline-doc-title")).toHaveValue(/^Meeting notes — /);
      const place = dialog.getByTestId("new-outline-doc-place");
      await expect(place.locator("option").first()).toHaveText("Core Banking Migration (top level)");
      await expect(place.locator("option")).toHaveText([
        "Core Banking Migration (top level)",
        "Core Banking Migration › Project kickoff",
        "Core Banking Migration › Project kickoff › Scope & success criteria",
        "Core Banking Migration › Project kickoff › Stakeholder map",
        "Core Banking Migration › Cut-over runbook",
      ]);
      await place.selectOption({ label: "Core Banking Migration › Project kickoff" });
      await dialog.getByTestId("new-outline-doc-title").fill("Weekly sync");
      await dialog.getByLabel(/Publish now/).uncheck();
      await dialog.getByTestId("new-outline-doc-submit").click();

      await expect(dialog).toBeHidden();
      expect(posts).toEqual([
        { title: "Weekly sync", publish: false, templateId: "11111111-1111-4111-8111-111111111111", parentDocumentId: "kickoff" },
      ]);
      expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([`${DOCS_BASE}/doc/new-page-abc`]);
      // The new tab's opener was severed by hand.
      expect(await page.evaluate(() => (window as unknown as { __lastOpened: { opener: unknown } }).__lastOpened.opener)).toBeNull();
    });

    test("a blocked popup leaves the dialog open with a focused link to the new page", async ({ page, seededProject }) => {
      await setup(page, treeResponse);
      await page.addInitScript(() => {
        window.open = (() => null) as typeof window.open;
      });
      await page.route("**/api/outline/templates", (r) => json(r, []));
      await page.route(`**/api/projects/${seededProject.projectId}/outline/docs`, async (r) => {
        if (r.request().method() !== "POST") return r.fallback();
        return json(r, { id: "99999999-9999-4999-8999-999999999999", title: "T", url: `${DOCS_BASE}/doc/new-page-abc` }, 201);
      });
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
      await page.getByTestId("new-outline-doc").click();
      const dialog = page.getByRole("dialog", { name: "New Outline doc" });
      await dialog.getByTestId("new-outline-doc-title").fill("Notes");
      await dialog.getByTestId("new-outline-doc-submit").click();
      const link = dialog.getByRole("link", { name: /Open it in Outline/ });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", `${DOCS_BASE}/doc/new-page-abc`);
      await expect(link).toBeFocused();
    });

    test("a lost connection (409) refreshes the connection state so the tab switches to Connect", async ({ page, seededProject }) => {
      let connected = true;
      await page.route("**/api/outline/me", (r) =>
        json(r, { configured: true, connected, outlineEmail: connected ? "rina@acme.test" : null, expiresAt: null }),
      );
      await page.route("**/api/outline/config", (r) => json(r, { baseUrl: DOCS_BASE }));
      await page.route(`**/api/projects/${seededProject.projectId}/outline/docs`, async (r) => {
        if (r.request().method() === "POST") {
          connected = false;
          return json(r, { error: "Connect your Outline account first.", code: "outline_not_connected" }, 409);
        }
        return connected
          ? json(r, treeResponse)
          : json(r, { error: "Connect your Outline account first.", code: "outline_not_connected" }, 409);
      });
      await page.route("**/api/outline/templates", (r) => json(r, []));
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
      await page.getByTestId("new-outline-doc").click();
      const dialog = page.getByRole("dialog", { name: "New Outline doc" });
      await dialog.getByTestId("new-outline-doc-title").fill("Notes");
      await dialog.getByTestId("new-outline-doc-submit").click();
      // The failure refreshes the connection and the tree: the tab drops to "Connect"
      // (taking the dialog with it) instead of leaving a stale tree behind.
      await expect(page.getByTestId("outline-docs-connect")).toBeVisible();
      await expect(page.getByTestId("outline-doc-row")).toHaveCount(0);
      await expect(dialog).toBeHidden();
    });

    test("a blank page at the collection's top level sends no template and no parent; errors stay in the dialog", async ({ page, seededProject }) => {
      await setup(page, treeResponse);
      await page.route("**/api/outline/templates", (r) => json(r, []));
      const posts: unknown[] = [];
      await page.route(`**/api/projects/${seededProject.projectId}/outline/docs`, async (r) => {
        if (r.request().method() !== "POST") return r.fallback();
        posts.push(r.request().postDataJSON());
        return json(r, { error: "The parent page is not inside the linked Outline page or collection.", code: "outline_parent_outside_anchor" }, 400);
      });
      await loginViaUi(page);
      await page.goto(`/projects/${seededProject.projectId}/docs`, { waitUntil: "networkidle" });
      await page.getByTestId("new-outline-doc").click();
      const dialog = page.getByRole("dialog", { name: "New Outline doc" });
      await dialog.getByTestId("new-outline-doc-title").fill("Notes");
      await dialog.getByTestId("new-outline-doc-submit").click();
      await expect(dialog.getByRole("alert")).toContainText("not inside the linked Outline page");
      await expect(dialog).toBeVisible();
      expect(posts).toEqual([{ title: "Notes", publish: true }]);
    });
  });
});

test.describe("Session robustness", () => {
  test("a backend hiccup on the boot /auth/me check keeps the session", async ({ page }) => {
    await loginViaUi(page);
    let failed = 0;
    await page.route("**/api/auth/me", async (r) => {
      if (failed < 1) {
        failed += 1;
        return r.fulfill({ status: 503, json: { error: "unavailable" } });
      }
      return r.fallback();
    });
    await page.goto("/overview", { waitUntil: "domcontentloaded" });
    await expect.poll(() => failed).toBe(1);
    // Still signed in: not bounced to /login, the app shell is there.
    await page.waitForTimeout(1500);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /overview/i }).first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("solvro.token"))).not.toBeNull();
  });

  test("a 401 on the boot check still signs out", async ({ page }) => {
    await loginViaUi(page);
    await page.route("**/api/auth/me", (r) => r.fulfill({ status: 401, json: { error: "token revoked", code: "token_revoked" } }));
    await page.goto("/overview", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/);
  });
});
