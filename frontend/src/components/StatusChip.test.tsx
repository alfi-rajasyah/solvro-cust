// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TaskStatusChip, statusToneClass } from "./StatusChip";

afterEach(cleanup);

describe("TaskStatusChip", () => {
  it("shows the workspace status name and tone when given a def", () => {
    const { container } = render(<TaskStatusChip status="IN_PROGRESS" def={{ name: "QA / UAT", color: "violet" }} />);
    const chip = container.firstElementChild!;
    expect(chip.textContent).toBe("QA / UAT");
    expect(chip.className).toContain("bg-chip-violet-bg");
  });

  it("maps the primary tone key to today's In-progress tint", () => {
    const { container } = render(<TaskStatusChip status="IN_PROGRESS" def={{ name: "In progress", color: "primary" }} />);
    expect(container.firstElementChild!.className).toContain("bg-primary/10");
  });

  it("falls back to the bare category label and tone without a def", () => {
    const { container } = render(<TaskStatusChip status="DONE" />);
    const chip = container.firstElementChild!;
    expect(chip.textContent).toBe("Done");
    expect(chip.className).toContain("bg-chip-emerald-bg");
    expect(statusToneClass(null, "TODO")).toContain("bg-surface-container-high");
  });
});
