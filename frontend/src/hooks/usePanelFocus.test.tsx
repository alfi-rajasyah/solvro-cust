// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { usePanelFocus } from "./usePanelFocus";

afterEach(cleanup);

function Panel({ item, shell }: { item: number; shell: string }) {
  const ref = useRef<HTMLDivElement>(null);
  usePanelFocus(ref, item, shell);
  // A new key remounts the element, like a loading -> ready swap.
  return <div key={shell} ref={ref} role="dialog" tabIndex={-1} aria-label="Task" />;
}

function Harness({ item, shell = "ready" }: { item: number | null; shell?: string }) {
  return (
    <>
      <button type="button">Task A</button>
      <button type="button">Task B</button>
      {item !== null && <Panel item={item} shell={shell} />}
    </>
  );
}

describe("usePanelFocus", () => {
  it("returns focus to the opener when the panel closes", () => {
    const { rerender } = render(<Harness item={null} />);
    const a = screen.getByRole("button", { name: "Task A" });
    a.focus();
    rerender(<Harness item={1} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    rerender(<Harness item={null} />);
    expect(document.activeElement).toBe(a);
  });

  it("returns focus to the new opener after switching tasks", () => {
    const { rerender } = render(<Harness item={null} />);
    const a = screen.getByRole("button", { name: "Task A" });
    const b = screen.getByRole("button", { name: "Task B" });
    a.focus();
    rerender(<Harness item={1} />);
    b.focus();
    rerender(<Harness item={2} />);
    rerender(<Harness item={null} />);
    expect(document.activeElement).toBe(b);
  });

  it("does not return to the previous task's opener when the click did not focus a button", () => {
    const { rerender } = render(<Harness item={null} />);
    const a = screen.getByRole("button", { name: "Task A" });
    a.focus();
    rerender(<Harness item={1} />);
    // Safari/Firefox on macOS: clicking Task B leaves focus on <body>.
    (document.activeElement as HTMLElement).blur();
    rerender(<Harness item={2} />);
    rerender(<Harness item={null} />);
    expect(document.activeElement).not.toBe(a);
  });

  it("keeps the opener when the shell element is swapped for the same item", () => {
    const { rerender } = render(<Harness item={null} />);
    const a = screen.getByRole("button", { name: "Task A" });
    a.focus();
    rerender(<Harness item={1} shell="loading" />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    // The focused loading element unmounts, dropping focus to <body>.
    rerender(<Harness item={1} shell="ready" />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    rerender(<Harness item={null} />);
    expect(document.activeElement).toBe(a);
  });
});
