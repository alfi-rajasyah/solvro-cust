// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AddStoryForm } from "./EpicPanel";

afterEach(cleanup);

function Harness({ onSubmit, pending = false, initial = "" }: { onSubmit: () => void; pending?: boolean; initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <AddStoryForm
      value={v}
      onChange={setV}
      pending={pending}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    />
  );
}

describe("AddStoryForm", () => {
  it("disables the button while the title is empty or whitespace", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Add story" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Login" } });
    expect(btn.disabled).toBe(false);
  });

  it("submits on button click", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} initial="Login" />);
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits on Enter in the input", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} initial="Login" />);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the request runs", () => {
    render(<Harness onSubmit={vi.fn()} pending initial="Login" />);
    expect((screen.getByRole("button", { name: "Add story" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
