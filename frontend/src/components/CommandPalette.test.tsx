// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Autocomplete, AutocompleteInput } from "@/components/reui/autocomplete";
import { PALETTE_INPUT_CLASS } from "./CommandPalette";

afterEach(cleanup);

describe("CommandPalette search input", () => {
  it("overrides the vendored bordered input into a bare search line", () => {
    render(
      <Autocomplete items={[]}>
        <AutocompleteInput aria-label="Search" className={PALETTE_INPUT_CLASS} />
      </Autocomplete>,
    );
    const classes = screen.getByLabelText("Search").className.split(/\s+/);
    for (const kept of ["border-none", "px-0", "h-auto", "rounded-none", "focus-visible:ring-0", "focus-visible:border-transparent"]) {
      expect(classes).toContain(kept);
    }
    // The override must win over the vendored base, not sit beside it.
    expect(classes).not.toContain("focus-visible:ring-2");
    expect(classes).not.toContain("focus-visible:border-primary");
    expect(classes).not.toContain("px-2.5");
  });
});
