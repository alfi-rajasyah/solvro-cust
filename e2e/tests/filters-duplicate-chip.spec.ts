import { test, expect, loginViaUi } from "../fixtures/test";

// Regression cover for the "duplicate-chip mouse race" (docs/ISSUES.md, ReUI
// Filters phase deferred findings): Base UI's `useMenuItemCommonProps` can
// fire a programmatic `itemRef.current.click()` on mouseup once
// `allowMouseUpTriggerRef` is armed by a press held >=200ms, and
// `MenuCheckboxItem` (the value-picker rows inside a field's submenu, e.g.
// "TODO"/"IN PROGRESS"/"DONE" under "Status") fires `onCheckedChange` on
// every click — programmatic or natural — so a single user interaction can
// invoke the chip-creating handler twice in rapid succession. The fix lives
// in `reui/filters.tsx`: a shared `findMatchingFilter` guard applied at every
// unconditional `onChange([...filters, newFilter])` append site, skipping
// the append (or, for the multiselect session-tracking branch, adopting the
// existing filter's id) when a chip with the same field + identical values
// already exists.
//
// No prior spec asserted chip-count behavior on either filter toolbar
// (Tasks.tsx / Projects.tsx) before this — kanban-dnd.spec.ts's
// `openTasksPage` drives the same customer-chip flow as setup, but only to
// reach a filtered board state, never to assert on chip count. Both
// consumers' filter fields are all `type: "select"` with
// populated options, so every add routes through the field-then-value
// submenu flow (never the plain field-only `addFilter` path). Both also set
// `allowMultiple={false}`, which already removes an added field from the
// root add-filter list before a raced second activation typically lands
// (docs/ISSUES.md describes this as "incidental" shielding, observed 0/6 on
// repro, not a guaranteed backstop) — so this spec can't force the exact
// upstream timing deterministically. It drives the closest reproducible
// approximation (a >=200ms press-hold directly on the value checkbox item,
// mirroring the documented arming window) and asserts the invariant the
// guard exists to protect: one chip per field+value survives, however many
// add attempts are made.

test.describe("filters — duplicate-chip guard (desktop)", () => {
  test.beforeEach(async () => {
    test.skip(
      test.info().project.name !== "desktop",
      "Filter toolbar interactions are exercised on desktop",
    );
  });

  test("rapid add attempts on /tasks never produce more than one chip per field", async ({
    page,
  }) => {
    await loginViaUi(page);
    await page.goto("/tasks", { waitUntil: "networkidle" });

    const filterTrigger = page.getByRole("button", { name: "Filter", exact: true });
    await expect(filterTrigger).toBeVisible();

    // Chips render as `data-slot="button-group"` wrappers around a
    // `ButtonGroupText` label — scoped so this never matches the "Status"
    // column header the Tasks data grid also renders.
    const chipsFor = (label: string) =>
      page.locator('[data-slot="button-group"]', { hasText: label });

    await expect(chipsFor("Status")).toHaveCount(0);

    // Opens the add-filter menu, clicks the field to reveal its value
    // submenu, then press-holds (>=200ms, the documented arming window)
    // directly on the target value option before releasing — the closest
    // reproducible approximation of the upstream race without reaching into
    // Base UI internals.
    const addChipViaLongPress = async (fieldLabel: string, valueLabel: string) => {
      await filterTrigger.click();
      const fieldOption = page.getByRole("option", { name: fieldLabel, exact: true });
      await expect(fieldOption).toBeVisible();
      await fieldOption.click();

      const valueOption = page.getByRole("option", { name: valueLabel, exact: true });
      await expect(valueOption).toBeVisible();
      const box = await valueOption.boundingBox();
      if (!box) throw new Error(`${valueLabel} option not visible`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(250);
      await page.mouse.up();
    };

    await addChipViaLongPress("Status", "TODO");
    await page.waitForTimeout(300);

    // Core invariant: exactly one "Status" chip, never two.
    await expect(chipsFor("Status")).toHaveCount(1);

    // A second, distinct field + value: confirms the guard's field+values
    // equality check doesn't over-trigger and block a legitimate add for a
    // field with no existing chip.
    await addChipViaLongPress("Priority", "HIGH");
    await page.waitForTimeout(300);

    await expect(chipsFor("Status")).toHaveCount(1);
    await expect(chipsFor("Priority")).toHaveCount(1);

    // Reset leaves no chips behind (sanity check the toolbar is otherwise
    // unaffected by the guard).
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(chipsFor("Status")).toHaveCount(0);
    await expect(chipsFor("Priority")).toHaveCount(0);
  });
});
