import { apiBase, expect, loginViaUi, test } from "../fixtures/test";
import { login } from "../fixtures/seed";

// Customer Visibility (docs/plans/customer-visibility-spec.md §8 criterion
// 9): the admin API creates two TAM users, one customer per TAM (`tamId`
// set), and one ACTIVE project under each customer (so each customer also
// shows on the Daily Review per Decision 8/9). TAM A then logs in through
// the UI and must see customer A (owned) on both /customers and
// /daily-review, while customer B — owned by TAM B, with no project TAM A
// works on — stays invisible: the `customerVisibilityFilter` rule
// (backend/src/lib/visibility.ts) applied to `GET /customers` and
// `GET /daily-review`.
//
// Delta/presence based, not count based: the shared dev database already
// holds other customers (from manual QA, other specs, concurrent runs), so
// this only asserts our own stamp-named customers' presence/absence, never a
// total count — same defensive approach as daily-review.spec.ts.
//
// Runs on both Playwright projects (desktop + mobile) per
// playwright.config.ts — nothing here is viewport- or drag-specific, so
// there's no desktop-only skip.
//
// Nothing created here has a cleanup path: `DELETE /admin/users/:id` 400s
// once its target owns a project as TAM (`user_in_use`,
// backend/src/routes/admin.ts's blockers list), and customers/projects have
// no DELETE route at all (see daily-review.spec.ts's header comment for the
// identical tradeoff). Each run leaves two more TAM users, customers, and
// projects in the shared dev DB — consistent with every other spec's
// stamped-name, no-cleanup convention.

function stamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

test.describe("Customer visibility", () => {
  test("a TAM sees their own customer but not another TAM's, on /customers and /daily-review", async (
    { page },
    testInfo,
  ) => {
    const base = apiBase(testInfo);
    const admin = await login(base);
    const H = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
    const s = stamp();

    const tamAEmail = `e2e-cv-tam-a-${s}@solvro.test`;
    const tamBEmail = `e2e-cv-tam-b-${s}@solvro.test`;
    const password = "CvTamTest1234!";

    // --- Two TAM users via the admin API.
    const tamA = await json<{ id: number }>(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ email: tamAEmail, username: `e2e-cv-tam-a-${s}`, password, role: "TAM" }),
      }),
    );
    expect(tamA.id, "TAM A user was not created").toBeTruthy();

    const tamB = await json<{ id: number }>(
      await fetch(`${base}/api/admin/users`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ email: tamBEmail, username: `e2e-cv-tam-b-${s}`, password, role: "TAM" }),
      }),
    );
    expect(tamB.id, "TAM B user was not created").toBeTruthy();

    // --- One customer per TAM, unique names, `tamId` set to that TAM.
    const customerAName = `CV Customer A ${s}`;
    const customerBName = `CV Customer B ${s}`;

    const customerA = await json<{ id: number }>(
      await fetch(`${base}/api/customers`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          name: customerAName,
          description: "e2e customer-visibility fixture",
          tamId: tamA.id,
        }),
      }),
    );
    const customerB = await json<{ id: number }>(
      await fetch(`${base}/api/customers`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          name: customerBName,
          description: "e2e customer-visibility fixture",
          tamId: tamB.id,
        }),
      }),
    );

    // --- One ACTIVE project under each customer, TAM = that customer's TAM,
    // so each customer also has a Daily Review group (Decision 8/9).
    await json(
      await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          name: `CV Project A ${s}`,
          description: "e2e customer-visibility fixture",
          customerId: customerA.id,
          tamId: tamA.id,
          status: "ACTIVE",
        }),
      }),
    );
    await json(
      await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          name: `CV Project B ${s}`,
          description: "e2e customer-visibility fixture",
          customerId: customerB.id,
          tamId: tamB.id,
          status: "ACTIVE",
        }),
      }),
    );

    await loginViaUi(page, tamAEmail, password);

    // ------------------------------------------------------------------
    // /customers: customer A's row (h3 name in the Customer cell of the
    // Customers.tsx data-grid) is visible; customer B's is absent.
    // ------------------------------------------------------------------
    await page.goto("/customers", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { level: 3, name: customerAName, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: customerBName, exact: true })).toHaveCount(0);

    // ------------------------------------------------------------------
    // /daily-review: customer A's group header (h2, CustomerGroup.tsx) is
    // visible; customer B's group is absent. The h2 wraps the whole
    // summary-row toggle button (name, project count, TAM line, reviewed
    // count, status pill), so its accessible name is that entire button's
    // text, not just the customer name — substring match (no `exact`), same
    // as daily-review.spec.ts's `customerHeading` locator.
    // ------------------------------------------------------------------
    await page.goto("/daily-review", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await expect(page.getByRole("heading", { level: 2, name: customerAName })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: customerBName })).toHaveCount(0);
  });
});
