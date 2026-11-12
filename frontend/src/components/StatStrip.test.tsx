// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatStrip, type StatItem } from "./StatStrip";

afterEach(cleanup);

function renderStrip(items: StatItem[]) {
  return render(
    <MemoryRouter>
      <StatStrip label="Summary" items={items} testId="strip" />
    </MemoryRouter>,
  );
}

describe("StatStrip", () => {
  it("renders a named list with one item per stat", () => {
    renderStrip([
      { key: "a", value: 3, label: "overdue tasks" },
      { key: "b", value: 5, label: "due this week" },
    ]);
    const list = screen.getByRole("list", { name: "Summary" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(list.textContent).toContain("overdue tasks");
  });

  it("makes a stat with `to` a link and leaves the others as plain cells", () => {
    renderStrip([
      { key: "a", value: 3, label: "overdue tasks", to: "/tasks?view=overdue", ariaLabel: "Overdue: 3 tasks" },
      { key: "b", value: 5, label: "open risks" },
    ]);
    const link = screen.getByRole("link", { name: "Overdue: 3 tasks" });
    expect(link.getAttribute("href")).toBe("/tasks?view=overdue");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("colours only the number, and only for an action tone", () => {
    renderStrip([
      { key: "a", value: 3, label: "overdue", tone: "bad", testId: "s-bad" },
      { key: "b", value: 2, label: "pending", tone: "warn", testId: "s-warn" },
      { key: "c", value: 9, label: "notes", testId: "s-plain" },
    ]);
    expect(screen.getByTestId("s-bad-value").className).toContain("text-error");
    expect(screen.getByTestId("s-warn-value").className).toContain("text-chip-amber-text");
    expect(screen.getByTestId("s-plain-value").className).toContain("text-on-surface");
    expect(screen.getByTestId("s-bad").className).not.toContain("text-error");
  });

  it("shows the denominator and clamps the progress bar", () => {
    const { container } = renderStrip([
      { key: "a", value: "31.5 h", of: "of 40 h", label: "logged", progress: 140, progressTone: "warn" },
    ]);
    expect(container.textContent).toContain("of 40 h");
    const bar = container.querySelector<HTMLElement>("[aria-hidden='true'] > span")!;
    expect(bar.style.width).toBe("100%");
    expect(bar.className).toContain("bg-chip-amber-text");
  });

  it("uses a six-track phone grid for five stats so no cell is left empty", () => {
    renderStrip(
      ["a", "b", "c", "d", "e"].map((key) => ({ key, value: 1, label: key })),
    );
    const list = screen.getByTestId("strip");
    expect(list.className).toContain("grid-cols-6");
    const spans = [...list.querySelectorAll("li")].map((li) => li.className);
    expect(spans.slice(0, 3).every((c) => c.includes("col-span-2"))).toBe(true);
    expect(spans.slice(3).every((c) => c.includes("col-span-3"))).toBe(true);
  });

  it("renders a label-only stat without a number", () => {
    renderStrip([{ key: "a", label: "Baseline", detail: "not locked", testId: "s" }]);
    expect(screen.queryByTestId("s-value")).toBeNull();
    expect(screen.getByTestId("s").textContent).toContain("Baseline");
    // Its detail stays visible on phones: it is the stat's only content.
    const detail = screen.getByText("not locked");
    expect(detail.className).toContain("block");
    expect(detail.className).not.toMatch(/(^| )hidden( |$)/);
  });
});
