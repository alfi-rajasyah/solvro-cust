import { describe, expect, it } from "vitest";
import type { PipelineStage } from "@/lib/pipelineFormat";
import { computePipelineKpis, daysUntilDeadline, isDealOverdue, probabilityTone } from "./kpi";
import type { PipelineBoardDeal } from "./adapter";

type Deal = Pick<PipelineBoardDeal, "dealValue" | "stage" | "picId" | "deadline" | "wonAt">;

function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    dealValue: 0,
    stage: "ASSESSMENT",
    picId: null,
    deadline: null,
    wonAt: null,
    ...overrides,
  };
}

// Fixed "today" so date-relative assertions don't depend on the wall clock.
const TODAY = new Date(2026, 7, 14); // 2026-08-14, local midnight

describe("daysUntilDeadline / isDealOverdue", () => {
  it("is 0 for a deadline that is today", () => {
    expect(daysUntilDeadline("2026-08-14", TODAY)).toBe(0);
  });

  it("is positive for a future deadline", () => {
    expect(daysUntilDeadline("2026-08-21", TODAY)).toBe(7);
  });

  it("is negative for a past deadline, and that deadline is overdue", () => {
    expect(daysUntilDeadline("2026-08-10", TODAY)).toBe(-4);
    expect(isDealOverdue("2026-08-10", TODAY)).toBe(true);
  });

  it("a future/today deadline is not overdue", () => {
    expect(isDealOverdue("2026-08-14", TODAY)).toBe(false);
    expect(isDealOverdue("2026-08-21", TODAY)).toBe(false);
  });

  it("a null deadline is never overdue", () => {
    expect(isDealOverdue(null, TODAY)).toBe(false);
  });
});

describe("probabilityTone", () => {
  // Single source of truth for OpportunityCard.tsx/PipelineList.tsx/
  // OpportunityDetail.tsx's win% chip (finding S10) — previously three
  // identical, untested, unexported copies.
  it("is emerald at and above 70", () => {
    expect(probabilityTone(70)).toBe("emerald");
    expect(probabilityTone(100)).toBe("emerald");
  });

  it("is amber from 40 up to (not including) 70", () => {
    expect(probabilityTone(40)).toBe("amber");
    expect(probabilityTone(69)).toBe("amber");
  });

  it("is rose below 40", () => {
    expect(probabilityTone(39)).toBe("rose");
    expect(probabilityTone(0)).toBe("rose");
  });
});

describe("computePipelineKpis", () => {
  it("sums deal value across active (non-WON/DROP) deals only, for Total Pipeline", () => {
    const kpis = computePipelineKpis(
      [
        deal({ stage: "ASSESSMENT", dealValue: 100 }),
        deal({ stage: "RFP", dealValue: 200 }),
        deal({ stage: "WON", dealValue: 9_999 }),
        deal({ stage: "DROP", dealValue: 9_999 }),
      ],
      TODAY,
    );
    expect(kpis.totalPipelineValue).toBe(300);
    expect(kpis.activeDealCount).toBe(2);
  });

  it("counts deadline <=7d and <=3d among active deals only", () => {
    const kpis = computePipelineKpis(
      [
        deal({ stage: "ASSESSMENT", deadline: "2026-08-15" }), // +1d: soon + critical
        deal({ stage: "RFP", deadline: "2026-08-20" }), // +6d: soon only
        deal({ stage: "POC", deadline: "2026-09-30" }), // far: neither
        deal({ stage: "POC", deadline: null }), // no deadline: neither
        // Terminal-stage deal with a near deadline must NOT count — Velora's
        // own kpi-bar.tsx derives deadlineOpps from activeOpps, not the raw list.
        deal({ stage: "WON", deadline: "2026-08-15" }),
      ],
      TODAY,
    );
    expect(kpis.deadlineSoonCount).toBe(2);
    expect(kpis.deadlineCriticalCount).toBe(1);
  });

  it("reads Won this month from wonAt, not updated_at/anything else", () => {
    const kpis = computePipelineKpis(
      [
        // Noon UTC, not month-midnight — a UTC calendar-day boundary
        // fixture (e.g. "2026-08-01T00:00:00.000Z") shifts to the prior
        // local calendar day (and month) west of UTC, flaking `isSameMonth`
        // under e.g. TZ=America/Los_Angeles. Noon UTC stays within the same
        // calendar day (and month) in every real-world UTC offset.
        deal({ stage: "WON", dealValue: 1_000, wonAt: "2026-08-05T12:00:00.000Z" }),
        deal({ stage: "WON", dealValue: 2_000, wonAt: "2026-08-13T23:00:00.000Z" }),
        // Won last month — excluded even though it's still in WON.
        deal({ stage: "WON", dealValue: 5_000, wonAt: "2026-07-15T12:00:00.000Z" }),
        // WON with no wonAt (shouldn't happen post-M1, but must not throw/count).
        deal({ stage: "WON", dealValue: 7_000, wonAt: null }),
      ],
      TODAY,
    );
    expect(kpis.wonThisMonthValue).toBe(3_000);
    expect(kpis.wonThisMonthCount).toBe(2);
  });

  it("counts distinct PICs among active deals only", () => {
    const kpis = computePipelineKpis(
      [
        deal({ stage: "ASSESSMENT", picId: 1 }),
        deal({ stage: "RFP", picId: 1 }),
        deal({ stage: "RFP", picId: 2 }),
        deal({ stage: "ASSESSMENT", picId: null }),
        // Terminal-stage PIC must not count.
        deal({ stage: "WON", picId: 3 }),
      ],
      TODAY,
    );
    expect(kpis.activePicCount).toBe(2);
  });

  it("funnel excludes DROP and counts every other stage, including zero-count ones", () => {
    const kpis = computePipelineKpis(
      [deal({ stage: "ASSESSMENT" }), deal({ stage: "ASSESSMENT" }), deal({ stage: "DROP" })],
      TODAY,
    );
    const stages = kpis.funnel.map((f) => f.stage);
    expect(stages).not.toContain("DROP");
    expect(stages).toEqual([
      "ASSESSMENT",
      "RFP",
      "POC",
      "TECHNICAL_CLARIFICATION",
      "DELIVER_PROPOSAL",
      "WAITING_RESPONSE",
      "WON",
      "HOLD",
    ] satisfies PipelineStage[]);
    expect(kpis.funnel.find((f) => f.stage === "ASSESSMENT")?.count).toBe(2);
    expect(kpis.funnel.find((f) => f.stage === "RFP")?.count).toBe(0);
  });
});
