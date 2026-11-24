// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ProjectHeaderFacts } from "./ProjectHeaderFacts";
import { dateToDay } from "@/lib/dateField";
import type { ProjectDetail } from "@/lib/queries";

afterEach(cleanup);

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateToDay(d)!;
}

type Health = NonNullable<ProjectDetail["health"]>;

function project(overrides: Partial<ProjectDetail> = {}, health: Partial<Health> = {}) {
  return {
    id: 1,
    name: "Atlas",
    status: "ACTIVE",
    tam: { id: 1, username: "ola", email: "ola@solvro.pl" },
    customers: [{ id: 7, name: "Acme", isPrimary: true }],
    health: {
      progress: { done: 2, total: 4 },
      overdueCount: 0,
      openRiskCount: 0,
      startDate: dayOffset(-30),
      endDate: dayOffset(30),
      slipDays: null,
      ...health,
    },
    ...overrides,
  } as unknown as ProjectDetail;
}

function renderFacts(p: ProjectDetail) {
  return render(
    <MemoryRouter>
      <ProjectHeaderFacts project={p} />
    </MemoryRouter>,
  );
}

describe("ProjectHeaderFacts", () => {
  it("shows no health fact when there is nothing to act on", () => {
    renderFacts(project());
    const facts = screen.getByRole("group", { name: "Project facts" });
    expect(facts.textContent).not.toMatch(/No baseline|open risk|overdue|Past end/);
    expect(facts.textContent).toContain("50% · 2 of 4");
    expect(facts.textContent).toContain("TAM ola");
  });

  it("lists problems only when they are above zero", () => {
    renderFacts(project({}, { overdueCount: 3, openRiskCount: 1, slipDays: 5 }));
    const facts = screen.getByRole("group", { name: "Project facts" });
    expect(facts.textContent).toContain("3 overdue");
    expect(facts.textContent).toContain("1 open risk");
    expect(facts.textContent).toContain("5d behind baseline");
  });

  it("flags a live project past its end date but not a completed one", () => {
    renderFacts(project({}, { endDate: dayOffset(-1) }));
    expect(screen.getByText("Past end date")).toBeTruthy();
    cleanup();
    renderFacts(project({ status: "COMPLETED" }, { endDate: dayOffset(-1) }));
    expect(screen.queryByText("Past end date")).toBeNull();
    cleanup();
    renderFacts(project({ status: "CANCELLED" }, { endDate: dayOffset(-1) }));
    expect(screen.queryByText("Past end date")).toBeNull();
  });

  it("renders without a health block and shows no Health fact", () => {
    renderFacts(project({ health: undefined }));
    const facts = screen.getByRole("group", { name: "Project facts" });
    expect(facts.textContent).toContain("No tasks yet");
    expect(facts.textContent).toContain("No dates yet");
    expect(facts.textContent).not.toContain("Health");
  });
});
