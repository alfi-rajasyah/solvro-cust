import { describe, expect, it } from "vitest";
// @vitest-environment jsdom
import { ARROW_INSET, buildConnectorRoute, milestoneEntryRect, successorAttachRect, tryBuildConnectorRoute } from "./connector-paths";

const bar = { x: 100, y: 10, width: 80, height: 20 };
// Bounding box of a rotated 10px diamond (about 14px wide) inside a padded day box.
const diamond = { x: 306, y: 50, width: 14, height: 14 };
const milestoneBar = { x: 300, y: 50, width: 120, height: 20 };
const next = { x: 500, y: 90, width: 60, height: 20 };

describe("milestone connector endpoints", () => {
  it("enters a successor milestone at the diamond's left vertex", () => {
    const route = buildConnectorRoute(bar, milestoneEntryRect(diamond));
    expect(route.tipX).toBe(diamond.x);
    expect(route.tipX).toBe(milestoneEntryRect(diamond).x - ARROW_INSET);
    expect(route.tipY).toBe(diamond.y + diamond.height / 2);
  });

  it("leaves a milestone predecessor from the bar's right edge, clear of its title", () => {
    const route = buildConnectorRoute(milestoneBar, next);
    expect(route.d.startsWith(`M ${milestoneBar.x + milestoneBar.width} ${milestoneBar.y + 10}`)).toBe(true);
  });

  it("reads a real DOMRect (prototype getters), not an empty spread", () => {
    const rect = milestoneEntryRect(new DOMRect(306, 50, 14, 14));
    expect(rect).toEqual({ x: 306 + ARROW_INSET, y: 50, width: 0, height: 14 });
  });

  it("falls back to the bar rect when the diamond is missing or not finite", () => {
    expect(successorAttachRect(milestoneBar, undefined)).toBe(milestoneBar);
    expect(successorAttachRect(milestoneBar, { ...diamond, y: Number.NaN })).toBe(milestoneBar);
    expect(successorAttachRect(milestoneBar, diamond)).toEqual(milestoneEntryRect(diamond));
  });

  it("skips a connector with a non-finite endpoint instead of emitting NaN", () => {
    expect(tryBuildConnectorRoute(bar, { ...next, y: Number.NaN })).toBeNull();
    expect(tryBuildConnectorRoute({ ...bar, x: Number.POSITIVE_INFINITY }, next)).toBeNull();
  });
});
