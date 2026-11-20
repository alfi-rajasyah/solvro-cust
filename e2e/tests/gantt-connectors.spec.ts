import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { createTask, isoDateOffset } from "../fixtures/seed";

// A milestone connector once drew `NaN` paths (a spread DOMRect lost its
// getter fields). Unit tests cover the rect helpers; this guards the rendered
// result: a milestone with an incoming and an outgoing dependency draws
// finite connectors and raises no console or page error.

test.describe("gantt connectors — desktop", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "Gantt is desktop-only (hidden md:block)");
  });

  test("milestone with incoming and outgoing dependencies draws finite connector paths", async ({
    page,
    seededProject,
  }, testInfo) => {
    const base = apiBase(testInfo);
    const { token, projectId } = seededProject;
    const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const before = await createTask(base, token, projectId, {
      title: `Conn before ${s}`,
      status: "TODO",
      startDate: isoDateOffset(0),
      dueDate: isoDateOffset(1),
    });
    const milestone = await createTask(base, token, projectId, {
      title: `Conn milestone ${s}`,
      status: "TODO",
      dueDate: isoDateOffset(3),
      isMilestone: true,
    });
    const after = await createTask(base, token, projectId, {
      title: `Conn after ${s}`,
      status: "TODO",
      startDate: isoDateOffset(4),
      dueDate: isoDateOffset(5),
    });
    const link = async (predecessorTaskId: number, successorTaskId: number): Promise<number> => {
      const res = await fetch(`${base}/api/projects/${projectId}/dependencies`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ predecessorTaskId, successorTaskId, type: "HARD" }),
      });
      expect(res.ok, `dependency ${predecessorTaskId}->${successorTaskId}`).toBe(true);
      return ((await res.json()) as { id: number }).id;
    };
    const incomingId = await link(before.id, milestone.id);
    const outgoingId = await link(milestone.id, after.id);

    await loginViaUi(page);
    // Listen only once signed in: the sign-in screen's own third-party script can log errors that say nothing about the Gantt.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });

    await page.goto(`/projects/${projectId}/gantt`, { waitUntil: "networkidle" });

    await expect(page.locator(`[data-task-id="${milestone.id}"][data-milestone]`)).toBeVisible();
    // Check THESE two connectors by id: the shared project may hold other
    // dependencies from earlier specs, and a connector whose rect is not finite
    // is dropped (connector-paths.ts), not drawn as NaN, so an absent path is
    // the real failure mode.
    for (const [label, id] of [
      ["incoming", incomingId],
      ["outgoing", outgoingId],
    ] as const) {
      const path = page.locator(`[data-connector-id="${id}"] path[d]`).first();
      await expect(path, `${label} connector ${id} is drawn`).toBeAttached({ timeout: 10_000 });
      const d = (await path.getAttribute("d")) ?? "";
      expect(d, `${label} connector path`).toMatch(/^M\s*-?\d/);
      const nums = d.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) ?? [];
      expect(nums.length, `${label} connector has coordinates`).toBeGreaterThanOrEqual(4);
      expect(nums.every((n) => Number.isFinite(Number(n)))).toBe(true);
      expect(d).not.toMatch(/NaN|Infinity/);
    }
    await expect(page.locator('path[d*="NaN"]')).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
