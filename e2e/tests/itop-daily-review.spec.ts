import type { Page } from "@playwright/test";
import { apiBase, expect, loginViaUi, test } from "../fixtures/test";

// Daily Review's iTop strip (Task 2.2, docs/archive/plans/itop-integration.md
// — "Daily Review shows the operations picture" in
// docs/archive/plans/itop-integration-spec.md §2): GET /itop/status and GET /itop/daily are
// both intercepted via page.route, same rationale as itop-tickets.spec.ts —
// no real iTop instance needed, and `serviceWorkers: "block"` keeps the
// mocks authoritative against the built CI stack, which registers a PWA
// service worker that page.route cannot see through.
//
// The mock returns exactly one customer slice (a fresh customer created via
// the API, its project flipped ACTIVE so it actually appears on the page —
// same fixture pattern as daily-review.spec.ts). Real customers already on
// a shared dev DB (per that spec's header comment) may render their own
// CustomerGroup with no strip at all, since they're simply absent from the
// mocked payload — asserting exactly one `itop-daily-strip` on the whole
// page covers that "no strip for an unmapped/absent customer" case without
// having to enumerate every other group.

const ITOP_BASE_URL = "https://itop.example.test";

function isoOffsetHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

const RECENT_TICKETS = [
  {
    id: 2001,
    class: "Incident",
    ref: "R-2001",
    title: "Branch 5 VPN tunnel flapping",
    status: "escalated_ttr",
    operationalStatus: "ongoing",
    priority: "1",
    agentPersonId: 1,
    agentName: "Rina S.",
    teamName: "NOC",
    serviceName: "Network",
    callerName: "Ops",
    startDate: isoOffsetHours(-48),
    lastUpdate: isoOffsetHours(-1),
    tto: null,
    ttr: null,
    slaTtoPassed: true,
    slaTtrPassed: true,
    resolutionDate: null,
    isMine: false,
  },
  {
    id: 2002,
    class: "UserRequest",
    ref: "R-2002",
    title: "Firewall rule for the new HR app",
    status: "new",
    operationalStatus: "ongoing",
    priority: "2",
    agentPersonId: null,
    agentName: null,
    teamName: null,
    serviceName: "Network",
    callerName: "HR",
    startDate: isoOffsetHours(-0.5),
    lastUpdate: isoOffsetHours(-0.2),
    tto: isoOffsetHours(1),
    ttr: isoOffsetHours(1.3),
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    isMine: false,
  },
  {
    id: 2003,
    class: "UserRequest",
    ref: "R-2003",
    title: "Veeam job failing on VM-DB02",
    status: "resolved",
    operationalStatus: "closed",
    priority: "3",
    agentPersonId: 9,
    agentName: "Dedi P.",
    teamName: "Service Desk",
    serviceName: "Backup",
    callerName: "Mo",
    startDate: isoOffsetHours(-30),
    lastUpdate: isoOffsetHours(-3),
    tto: null,
    ttr: null,
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: isoOffsetHours(-3),
    isMine: false,
  },
];

async function mockItopStatus(page: Page): Promise<void> {
  await page.route("**/api/itop/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        baseUrl: ITOP_BASE_URL,
        lastSyncAt: new Date().toISOString(),
        lastSyncOk: true,
        refreshMinutes: 5,
      }),
    }),
  );
}

async function mockItopDaily(page: Page, customerId: number, customerName: string): Promise<void> {
  await page.route("**/api/itop/daily*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        date: new Date().toISOString().slice(0, 10),
        customers: [
          {
            customerId,
            customerName,
            orgName: "Northwind Freight Sdn Bhd",
            counts: { newToday: 2, resolvedToday: 1, slaBreached: 1, ongoing: 4 },
            recent: RECENT_TICKETS,
            syncedAt: new Date().toISOString(),
          },
        ],
      }),
    }),
  );
}

test.describe("Daily Review iTop strip", () => {
  test.use({ serviceWorkers: "block" });

  test("shows counts + recent tickets for a mapped customer, and Add to note inserts into the today draft", async ({
    page,
    seededProject,
  }, testInfo) => {
    const { token, userId, projectId } = seededProject;
    const base = apiBase(testInfo);
    const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    await loginViaUi(page);

    // Fixture: a fresh customer (tamId = the admin fixture user) with the
    // seeded project reassigned + flipped ACTIVE, so it actually renders a
    // CustomerGroup on /daily-review — same pattern as daily-review.spec.ts.
    const customerName = `iTop Daily Co ${stamp}`;
    const customerRes = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: customerName, description: "e2e iTop daily fixture", tamId: userId }),
    });
    expect(customerRes.ok, `create customer: ${customerRes.status}`).toBeTruthy();
    const customer = (await customerRes.json()) as { id: number };

    const projectRes = await fetch(`${base}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ status: "ACTIVE", customerId: customer.id }),
    });
    expect(projectRes.ok, `patch project: ${projectRes.status}`).toBeTruthy();

    await mockItopStatus(page);
    await mockItopDaily(page, customer.id, customerName);

    // The strip's counts bucket "today" by the VIEWER'S local day (user
    // decision) — useItopDaily sends `utcOffsetMinutes` (local minus UTC)
    // alongside `date` so the backend can bucket the same way.
    const dailyRequest = page.waitForRequest((req) => req.url().includes("/api/itop/daily"));

    await page.goto("/daily-review", { waitUntil: "networkidle" });

    expect((await dailyRequest).url()).toContain("utcOffsetMinutes=");

    const customerHeading = page.getByRole("heading", { level: 2, name: customerName });
    await expect(customerHeading).toBeVisible();
    const customerSection = customerHeading.locator("xpath=ancestor::section[1]");

    // Exactly one strip on the whole page — no other customer group (real
    // dev-DB data, absent from the mocked payload) gets one.
    await expect(page.getByTestId("itop-daily-strip")).toHaveCount(1);

    const strip = customerSection.getByTestId("itop-daily-strip");
    await expect(strip).toBeVisible();
    await expect(strip.getByText("2 new")).toBeVisible();
    await expect(strip.getByText("1 resolved")).toBeVisible();
    await expect(strip.getByText("1 SLA breached")).toBeVisible();
    await expect(strip.getByText(/4 ongoing/)).toBeVisible();

    const rows = strip.getByTestId("itop-daily-strip-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "R-2001" })).toBeVisible();

    // "Add to note" on the first (most recent) row appends "<ref> <title>"
    // to today's operations-note draft — nothing is saved until the user
    // presses Save. The button's accessible name is disambiguated per row
    // (`Add ${ref} to note`, DailyItopStrip.tsx) for a11y, so target it by
    // that rather than the shared visible label "Add to note".
    await rows.first().getByRole("button", { name: "Add R-2001 to note" }).click();

    const opsNoteTextarea = page.getByLabel(`Operations note for ${customerName}`);
    await expect(opsNoteTextarea).toHaveValue(/R-2001 Branch 5 VPN tunnel flapping/);

    // Persisting it: the required Title, then Save, then a full reload to
    // prove it's the SAVED note (not just the still-open draft) that
    // carries the ref — the draft alone wouldn't survive a reload. Scoped
    // to the week-rows container (not the whole operations-card article,
    // which also holds the iTop strip's own "R-2001 ..." link) so the
    // assertion can't accidentally match the strip row instead of the
    // saved note.
    const opsCard = opsNoteTextarea.locator("xpath=ancestor::article[1]");
    await opsCard.getByLabel("Title").fill(`iTop note ${stamp}`);
    await opsCard.getByRole("button", { name: "Save note" }).click();

    const notesContainer = page.locator(`#week-rows-customer-${customer.id}`);
    await expect(notesContainer.getByText(/R-2001 Branch 5 VPN tunnel flapping/)).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 2, name: customerName })).toBeVisible();
    await expect(notesContainer.getByText(/R-2001 Branch 5 VPN tunnel flapping/)).toBeVisible();
  });
});
