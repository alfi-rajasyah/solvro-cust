import { describe, expect, it } from "vitest";
import { cn } from "./utils";

/**
 * Regression coverage for the `extendTailwindMerge` fix (reui-data-grid.md
 * pilot fix round). Plain `twMerge` doesn't know this project's seven named
 * `@theme` typography roles (index.css: h1, h2, body-lg, body-sm,
 * data-mono, label-caps, meta) — before the fix, an unmatched `text-{name}` fell
 * through `font-size`'s validator to `text-color`'s default `isAny`
 * validator and got filed as a color utility instead. Two bugs followed:
 * no dedupe against a conflicting `text-{size}`, and — worse — silent
 * eviction of a genuine `text-{color}` class in the same `cn()` call (the
 * two-tone DataGrid header bug this suite guards against).
 */
describe("cn() — named @theme text roles vs. tailwind-merge's default config", () => {
  it("text-label-caps dedupes against a conflicting stock font-size class, keeping the named role", () => {
    // Order matters for twMerge (last-one-in-a-group wins) — text-label-caps
    // is listed second, so it must be the one that survives.
    const result = cn("text-sm", "text-label-caps");
    expect(result).toContain("text-label-caps");
    expect(result).not.toContain("text-sm");
  });

  it("text-sm loses to a later text-label-caps regardless of which side carries the extra classes", () => {
    const result = cn("text-muted-foreground text-sm font-medium", "text-label-caps font-bold");
    expect(result).toContain("text-label-caps");
    expect(result).not.toContain("text-sm");
  });

  it("text-label-caps no longer collides with a genuine text-color class (the two-tone header bug)", () => {
    const result = cn("text-muted-foreground", "text-label-caps");
    // Before the fix, text-label-caps was misfiled as a color utility and
    // evicted text-muted-foreground from the same classGroup.
    expect(result).toContain("text-muted-foreground");
    expect(result).toContain("text-label-caps");
  });

  it("text-meta keeps a sibling text-color class and evicts a stock font-size class", () => {
    const kept = cn("text-meta", "text-primary");
    expect(kept).toContain("text-meta");
    expect(kept).toContain("text-primary");
    const swapped = cn("text-xs text-primary", "text-meta");
    expect(swapped).toContain("text-meta");
    expect(swapped).toContain("text-primary");
    expect(swapped).not.toMatch(/text-xs(?!\w)/);
  });

  it("font-bold still evicts font-medium (independent of the theme.text fix — a stock class-group pairing)", () => {
    const result = cn("font-medium", "font-bold");
    expect(result).toContain("font-bold");
    expect(result).not.toContain("font-medium");
  });

  it("every named role dedupes against its stock font-size sibling without touching an adjacent text-color class", () => {
    const roles = ["h1", "h2", "body-lg", "body-sm", "data-mono", "label-caps", "meta"];
    for (const role of roles) {
      const result = cn("text-red-500 text-sm", `text-${role}`);
      expect(result, `text-${role} should win over text-sm`).toContain(`text-${role}`);
      expect(result, `text-${role} should not drop text-sm's word boundary onto another role`).not.toMatch(
        new RegExp(`text-sm(?!\\w)`),
      );
      expect(result, `text-${role} must not evict the unrelated text-red-500 color class`).toContain(
        "text-red-500",
      );
    }
  });
});
