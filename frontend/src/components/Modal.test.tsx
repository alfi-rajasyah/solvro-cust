// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal, isDragActive } from "./Modal";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("Modal Escape and drag guard", () => {
  it("closes on Escape when no drag is lifted", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">body</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while a dnd-kit activator is lifted", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">body</Modal>);
    const handle = document.createElement("button");
    handle.setAttribute("aria-pressed", "true");
    handle.setAttribute("aria-roledescription", "draggable");
    document.body.appendChild(handle);
    expect(isDragActive()).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a new onClose mid-drag keeps the listener ahead of dnd-kit's cancel listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Modal open onClose={first} title="T">body</Modal>);
    const handle = document.createElement("button");
    handle.setAttribute("aria-pressed", "true");
    handle.setAttribute("aria-roledescription", "draggable");
    document.body.appendChild(handle);
    // Stands in for dnd-kit: added when the drag starts, it drops the lift on Escape.
    const cancelDrag = (e: KeyboardEvent) => {
      if (e.key === "Escape") handle.setAttribute("aria-pressed", "false");
    };
    document.addEventListener("keydown", cancelDrag);
    // A parent re-render mid-drag hands the modal a new onClose.
    rerender(<Modal open onClose={second} title="T">body</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    document.removeEventListener("keydown", cancelDrag);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    // After the drag, Escape closes through the latest onClose.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("a lifted sortable activator counts as a drag; an unrelated roledescription does not", () => {
    const h = document.createElement("button");
    h.setAttribute("aria-pressed", "true");
    h.setAttribute("aria-roledescription", "sortable");
    document.body.appendChild(h);
    expect(isDragActive()).toBe(true);
    h.setAttribute("aria-roledescription", "toggle");
    expect(isDragActive()).toBe(false);
  });

  it("an ordinary pressed toggle button is not a drag", () => {
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", "true");
    document.body.appendChild(b);
    expect(isDragActive()).toBe(false);
  });

  it("the header X uses onHeaderClose when given", () => {
    const onClose = vi.fn();
    const onHeaderClose = vi.fn();
    render(<Modal open onClose={onClose} onHeaderClose={onHeaderClose} title="T">body</Modal>);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onHeaderClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
