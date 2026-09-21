import { describe, expect, it } from "vitest";
import {
  HATCH_BASE_ALPHA,
  HATCH_CANVAS_HEX_DARK,
  HATCH_CANVAS_HEX_LIGHT,
  HATCH_STRIPE_ALPHA,
  hatchCompositeHex,
  hexToRgba,
  progressHatchBackground,
} from "./palette";

/**
 * Gantt visual refresh Task 3: the incomplete portion of a task bar renders
 * as a diagonal hatch of the bar color (a dimmed base band alternating with
 * a near-full-opacity stripe band) instead of the old flat black overlay.
 * These are the pure color/gradient-string helpers SolvroBar.tsx's JSX
 * consumes — see palette.ts's file-level comment for the full rationale.
 */
describe("hexToRgba", () => {
  it("converts a 6-digit hex + alpha into an rgba() string", () => {
    expect(hexToRgba("#3b82f6", 0.5)).toBe("rgba(59, 130, 246, 0.5)");
  });

  it("works without a leading #", () => {
    expect(hexToRgba("10b981", 1)).toBe("rgba(16, 185, 129, 1)");
  });

  it("round-trips black and white at full alpha", () => {
    expect(hexToRgba("#000000", 1)).toBe("rgba(0, 0, 0, 1)");
    expect(hexToRgba("#ffffff", 1)).toBe("rgba(255, 255, 255, 1)");
  });
});

describe("progressHatchBackground", () => {
  it("builds the exact gradient string — locks stop order/geometry/units", () => {
    // A change to band width, angle, or stop order is a visual regression;
    // pin the full string rather than just its substrings.
    expect(progressHatchBackground("#3b82f6")).toBe(
      "repeating-linear-gradient(135deg, rgba(59, 130, 246, 0.35) 0px, " +
        "rgba(59, 130, 246, 0.35) 4px, rgba(59, 130, 246, 0.9) 4px, " +
        "rgba(59, 130, 246, 0.9) 8px)",
    );
  });

  it("alternates a dimmed base band with a near-solid stripe band of the same color", () => {
    const bg = progressHatchBackground("#3b82f6");
    const base = hexToRgba("#3b82f6", HATCH_BASE_ALPHA);
    const stripe = hexToRgba("#3b82f6", HATCH_STRIPE_ALPHA);
    expect(bg).toContain(base);
    expect(bg).toContain(stripe);
  });

  it("keeps the stripe band read as the bar color — never dimmer than the base band", () => {
    // Guards the "bar color over a dimmed base" invariant regardless of the
    // exact alpha values a future tuning pass picks.
    expect(HATCH_STRIPE_ALPHA).toBeGreaterThan(HATCH_BASE_ALPHA);
  });

  it("produces a different gradient per bar color (no shared/cached string)", () => {
    const blue = progressHatchBackground("#3b82f6");
    const emerald = progressHatchBackground("#10b981");
    expect(blue).not.toBe(emerald);
  });
});

describe("hatchCompositeHex", () => {
  it("builds the exact opaque composite for a known hex over the dark canvas", () => {
    // bar #3b82f6 (59,130,246) over the dark canvas #1a1a18 (26,26,24) at
    // mean alpha (0.35 + 0.9) / 2 = 0.625.
    expect(hatchCompositeHex("#3b82f6", HATCH_CANVAS_HEX_DARK)).toBe("#2f5ba3");
  });

  it("builds the exact opaque composite for a known hex over the light canvas", () => {
    // Same bar color and mean alpha, over the light canvas #f9f9f7 instead —
    // the T3 phase-review fix: caller supplies the resolved theme's canvas,
    // so light and dark must NOT produce the same composite.
    expect(hatchCompositeHex("#3b82f6", HATCH_CANVAS_HEX_LIGHT)).toBe("#82aff6");
  });

  it("changes with the canvas for the same bar color (theme-aware, not a fixed default)", () => {
    const dark = hatchCompositeHex("#94a3b8", HATCH_CANVAS_HEX_DARK);
    const light = hatchCompositeHex("#94a3b8", HATCH_CANVAS_HEX_LIGHT);
    expect(dark).not.toBe(light);
  });

  it("always returns a 7-char #rrggbb string, never an alpha channel", () => {
    const hex = hatchCompositeHex("#10b981", HATCH_CANVAS_HEX_DARK);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("is opaque — composites toward the canvas, never toward the bar's own full hex", () => {
    // A bar color far from the dark canvas (white) must land strictly
    // between the two, not equal either endpoint.
    const composite = hatchCompositeHex("#ffffff", HATCH_CANVAS_HEX_DARK);
    expect(composite).not.toBe("#ffffff");
    expect(composite).not.toBe(HATCH_CANVAS_HEX_DARK);
  });
});
