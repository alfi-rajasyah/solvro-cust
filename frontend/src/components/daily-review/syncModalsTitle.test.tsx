// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DailyReviewCustomer } from "@/lib/queries";
import { MidweekSyncModal } from "./MidweekSyncModal";
import { ReflectionSyncModal } from "./ReflectionSyncModal";

const mutate = vi.fn();

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  return { ...actual, useSaveWeeklyUpdate: () => ({ mutate, isPending: false }) };
});

const week = { key: "2026-W47", start: "2026-11-16", days: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"] };

function customer(extra: Record<string, unknown>): DailyReviewCustomer {
  return {
    id: 1,
    name: "Acme",
    tam: null,
    projects: [],
    operationsNotes: [],
    previousWeeklyUpdate: null,
    weeklyUpdate: { health: null, category: "", updatedAt: "2026-11-16T00:00:00Z", ...extra },
  } as unknown as DailyReviewCustomer;
}

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

describe("sync modals: save blocked by a missing title", () => {
  it("Mid-week names, marks and focuses the untitled highlight", () => {
    const c = customer({
      highlights: [
        { id: 1, position: 0, title: "Shipped", detail: "", risk: "", action: "" },
        { id: 2, position: 1, title: "", detail: "", risk: "late vendor", action: "" },
      ],
    });
    render(<MidweekSyncModal customer={c} week={week} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save mid-week" }));
    expect(screen.getByText("Highlight 2 needs a title.")).toBeTruthy();
    const title = screen.getByLabelText("Highlight 2 title for Acme");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(title);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: "Vendor slip" } });
    expect(title.getAttribute("aria-invalid")).toBeNull();
  });

  it("Mid-week numbers the card by its position among all cards", () => {
    const c = customer({
      highlights: [
        { id: 1, position: 0, title: "Shipped", detail: "", risk: "", action: "" },
        { id: 2, position: 1, title: "", detail: "", risk: "", action: "" },
        { id: 3, position: 2, title: "", detail: "", risk: "slip", action: "" },
      ],
    });
    render(<MidweekSyncModal customer={c} week={week} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save mid-week" }));
    expect(screen.getByText("Highlight 3 needs a title.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Highlight 3 title for Acme"));
  });

  it("Reflection names, marks and focuses the untitled achievement", () => {
    const c = customer({
      achievements: [
        { id: 1, position: 0, title: "Done", detail: "" },
        { id: 2, position: 1, title: "", detail: "", lessonLearned: "keep scope small" },
      ],
    });
    render(<ReflectionSyncModal customer={c} week={week} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByText("Achievement 2 needs a title.")).toBeTruthy();
    const title = screen.getByLabelText("Achievement 2 title for Acme");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(title);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: "Lesson" } });
    expect(title.getAttribute("aria-invalid")).toBeNull();
  });
});
