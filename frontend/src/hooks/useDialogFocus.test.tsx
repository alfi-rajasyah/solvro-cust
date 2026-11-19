// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useDialogFocus } from "./useDialogFocus";

// jsdom has no layout, so every element reports zero client rects and the
// hook's visibility filter would drop them all.
beforeAll(() => {
  HTMLElement.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});
afterEach(cleanup);

function Dialog({ withTrailingButton }: { withTrailingButton: boolean }) {
  const { ref, onKeyDown } = useDialogFocus(true);
  return (
    <div ref={ref} role="dialog" tabIndex={-1} onKeyDown={onKeyDown}>
      <input aria-label="first" />
      <h3 tabIndex={-1}>Heading</h3>
      {withTrailingButton && <button type="button">last</button>}
    </div>
  );
}

describe("useDialogFocus Tab trap", () => {
  it("wraps forward Tab from a tabIndex=-1 element with nothing tabbable after it", () => {
    render(<Dialog withTrailingButton={false} />);
    const heading = screen.getByRole("heading");
    heading.focus();
    const notPrevented = fireEvent.keyDown(heading, { key: "Tab" });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText("first"));
  });

  it("leaves Tab to the browser when a tabbable element follows the tabIndex=-1 one", () => {
    render(<Dialog withTrailingButton />);
    const heading = screen.getByRole("heading");
    heading.focus();
    expect(fireEvent.keyDown(heading, { key: "Tab" })).toBe(true);
  });

  it("wraps Shift+Tab from a tabIndex=-1 element with nothing tabbable before it", () => {
    function Leading() {
      const { ref, onKeyDown } = useDialogFocus(true);
      return (
        <div ref={ref} role="dialog" tabIndex={-1} onKeyDown={onKeyDown}>
          <h3 tabIndex={-1}>Heading</h3>
          <button type="button">last</button>
        </div>
      );
    }
    render(<Leading />);
    const heading = screen.getByRole("heading");
    heading.focus();
    expect(fireEvent.keyDown(heading, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "last" }));
  });

  it("still wraps from the last tabbable element to the first", () => {
    render(<Dialog withTrailingButton />);
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText("first"));
  });
});
