// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { Drawer } from "./Drawer";

afterEach(cleanup);

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">Opener</button>
      <Drawer open={open} onClose={vi.fn()} title="Edit task">
        <input aria-label="Title" />
      </Drawer>
    </>
  );
}

describe("Drawer focus", () => {
  it("does not move focus when it opens", () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener when it closes", () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(<Harness open />);
    screen.getByLabelText("Title").focus();
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener when it unmounts while open", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <Drawer open onClose={vi.fn()} title="Edit task">
        <input aria-label="Title" />
      </Drawer>,
    );
    screen.getByLabelText("Title").focus();
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("returns focus to the opener when a child takes focus on mount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <Drawer open={false} onClose={vi.fn()} title="Edit task">
        <input aria-label="Title" autoFocus />
      </Drawer>,
    );
    rerender(
      <Drawer open onClose={vi.fn()} title="Edit task">
        <input aria-label="Title" autoFocus />
      </Drawer>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    rerender(
      <Drawer open={false} onClose={vi.fn()} title="Edit task">
        <input aria-label="Title" autoFocus />
      </Drawer>,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("leaves focus alone when the opener left the document", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <Drawer open onClose={vi.fn()} title="Edit task">
        <input aria-label="Title" />
      </Drawer>,
    );
    screen.getByLabelText("Title").focus();
    opener.remove();
    unmount();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps focus on its autofocused input under StrictMode's simulated unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    render(
      <StrictMode>
        <Drawer open onClose={vi.fn()} title="Edit task">
          <input aria-label="Title" autoFocus />
        </Drawer>
      </StrictMode>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    opener.remove();
  });

  it("leaves focus where the user moved it when it closes", () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(<Harness open />);
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});
