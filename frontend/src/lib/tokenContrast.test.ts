import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIGHT_PREVIEW_VARS } from "./themePreview";

// Pins WCAG AA (≥ 4.5:1, the small-text threshold — chips and buttons are
// 12–15px) for the colour pairs the app renders as text on a fill, in both
// themes. The values are parsed from index.css, so a token edit that drops a
// pair below AA fails here (docs/archive/plans/antislop-port.md).

const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");

type Rgb = [number, number, number];

function block(selector: ":root" | ".dark"): Record<string, Rgb> {
  // Match the rule line itself (line start, own line) — comments in index.css
  // also mention `:root { … }`.
  const escaped = selector.replace(".", "\\.");
  const match = new RegExp(`^[ \\t]*${escaped} \\{[ \\t]*$`, "m").exec(css);
  if (!match) throw new Error(`${selector} block not found in index.css`);
  const start = match.index;
  const body = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, Rgb> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return tokens;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text token, fill token]
const PAIRS: [string, string][] = [
  ["emerald-text", "emerald-bg"],
  ["amber-text", "amber-bg"],
  ["rose-text", "rose-bg"],
  ["violet-text", "violet-bg"],
  ["on-primary", "primary"],
  ["on-error", "error"],
  ["on-error-container", "error-container"],
  // The chip text tones double as the success / warning / danger text colours
  // on plain surfaces (e.g. Project Overview accents, Admin icons).
  ["emerald-text", "surface-container-lowest"],
  ["amber-text", "surface-container-lowest"],
  ["rose-text", "surface-container-lowest"],
];

describe.each([":root", ".dark"] as const)("token contrast in %s", (selector) => {
  const tokens = block(selector);

  it.each(PAIRS)("%s on %s is at least 4.5:1", (text, fill) => {
    expect(tokens[text], `--${text} missing`).toBeDefined();
    expect(tokens[fill], `--${fill} missing`).toBeDefined();
    expect(contrast(tokens[text], tokens[fill])).toBeGreaterThanOrEqual(4.5);
  });
});

// `text-primary` (links, counts, active labels) sits on the page and inside
// cards, panels and hovered rows, so it is pinned against every surface it is
// allowed on, in both themes. Tuning it for white and the panel surfaces left it at
// 4.25:1 on the hover tint (docs/archive/plans/antislop-port.md).
const PRIMARY_TEXT_SURFACES = [
  "background",
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
];

describe.each([":root", ".dark"] as const)("primary as text in %s", (selector) => {
  const tokens = block(selector);

  it.each(PRIMARY_TEXT_SURFACES)("--primary on --%s is at least 4.5:1", (surface) => {
    expect(tokens[surface], `--${surface} missing`).toBeDefined();
    expect(contrast(tokens.primary, tokens[surface])).toBeGreaterThanOrEqual(4.5);
  });
});

// The StatusChip "blue" tone: text on a primary/20 tint (dark) over every
// surface the chip can sit on, up to the selected-row surface.
const TINT_SURFACES = [
  "background",
  "surface",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
];

describe("primary-tint-text on its primary/20 tint in .dark", () => {
  const tokens = block(".dark");

  it.each(TINT_SURFACES)("--primary-tint-text on primary/20 over --%s is at least 4.5:1", (surface) => {
    const tint = tokens.primary.map((c, i) => Math.round(c * 0.2 + tokens[surface][i] * 0.8)) as Rgb;
    expect(contrast(tokens["primary-tint-text"], tint)).toBeGreaterThanOrEqual(4.5);
  });
});

// The hover tint is pinned for light only. Dark Elitery Green (#3aae51) on
// dark surface-container-high measures 4.4986:1, a hair under 4.5, and the
// dark brand green is not this test's to move.
describe("primary as text on the hover tint", () => {
  it("light --primary on --surface-container-high is at least 4.5:1", () => {
    const light = block(":root");
    expect(contrast(light.primary, light["surface-container-high"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Settings light theme preview", () => {
  it("re-declares the same values as :root", () => {
    const light = block(":root");
    for (const [name, value] of Object.entries(LIGHT_PREVIEW_VARS)) {
      expect(value, name).toBe(light[name.slice(2)].join(" "));
    }
  });
});
