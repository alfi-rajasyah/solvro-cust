// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "@/lib/queries";
import { SectionColorCell, TaskDatesCell } from "./TreeCells";

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null,
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const task = {
  id: 1, status: "IN_PROGRESS", startDate: "2026-03-02T00:00:00.000Z", dueDate: "2026-03-09T00:00:00.000Z",
} as unknown as Task;

describe("TaskDatesCell", () => {
  it("hides the cell button while the editor is open and refocuses it on close", () => {
    render(<TaskDatesCell task={task} canEdit onSave={vi.fn()} todayDay={null} />);
    const button = screen.getByRole("button", { name: /2 – 9 Mar/ });
    expect(button.className).not.toContain("invisible");
    fireEvent.click(button);
    expect(button.className).toContain("invisible");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(button.className).not.toContain("invisible");
    expect(document.activeElement).toBe(button);
  });
});

describe("TaskDatesCell focus", () => {
  it("does not steal focus when focus already moved to another element", () => {
    render(
      <>
        <button type="button">outside</button>
        <TaskDatesCell task={task} canEdit onSave={vi.fn()} todayDay={null} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /2 – 9 Mar/ }));
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(document.activeElement).toBe(outside);
  });
});

describe("SectionColorCell", () => {
  it("renders a disabled swatch and no picker when canEdit is false", () => {
    render(<SectionColorCell sectionId={1} color="#123456" canEdit={false} onPick={vi.fn()} />);
    const swatch = screen.getByLabelText("Set section color") as HTMLButtonElement;
    expect(swatch.disabled).toBe(true);
    fireEvent.click(swatch);
    expect(screen.queryByLabelText("Close color picker")).toBeNull();
  });
});
