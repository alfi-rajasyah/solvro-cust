import { describe, expect, it } from "vitest";
import {
  formatIDR,
  formatIDRCompact,
  formatPipelineDate,
  formatWinProbability,
  STAGE_LABELS,
  STAGE_ORDER,
  TERMINAL_STAGES,
  type PipelineStage,
} from "./pipelineFormat";

/**
 * Expected values below are copied verbatim from Velora's `formatCurrency`
 * / `formatCurrencyCompact` (../VeloraApp lib/utils.ts), confirmed against
 * this repo's own Node runtime (host node and the `frontend` container both
 * agree — see pipelineFormat.ts's doc comments) rather than assumed.
 *
 * `formatIDR`'s Intl currency formatter separates "Rp" from the digits with
 * U+00A0 NO-BREAK SPACE, not a plain U+0020 space — genuine Intl/Velora
 * behavior, not a typo. NBSP is spelled out below so the byte-exact
 * assertion is visible/greppable rather than an invisible character in the
 * source.
 */
const NBSP = " ";

describe("formatIDR", () => {
  it("renders zero", () => {
    expect(formatIDR(0)).toBe(`Rp${NBSP}0`);
  });

  it("renders a typical deal value with '.' thousands separators and no decimals", () => {
    expect(formatIDR(1_250_000_000)).toBe(`Rp${NBSP}1.250.000.000`);
  });

  it("renders a small value", () => {
    expect(formatIDR(500_000)).toBe(`Rp${NBSP}500.000`);
  });

  it("renders a triliun-scale value in full (no abbreviation)", () => {
    expect(formatIDR(1_000_000_000_000)).toBe(`Rp${NBSP}1.000.000.000.000`);
  });
});

describe("formatIDRCompact", () => {
  it("renders zero via the plain grouped tier", () => {
    expect(formatIDRCompact(0)).toBe("Rp 0");
  });

  it("stays in the plain grouped tier just below the juta boundary", () => {
    expect(formatIDRCompact(999_999)).toBe("Rp 999.999");
  });

  it("switches to the 'jt' tier exactly at 1 juta", () => {
    expect(formatIDRCompact(1_000_000)).toBe("Rp 1jt");
  });

  it("rounds within the 'jt' tier (1.5 -> 2)", () => {
    expect(formatIDRCompact(1_500_000)).toBe("Rp 2jt");
  });

  it("rounds up to 1000jt just below the miliar boundary (stays in the 'jt' tier)", () => {
    // 999_999_999 / 1_000_000 = 999.999999 -> toFixed(0) rounds to "1000",
    // and the value is still < 1_000_000_000 so the 'M' tier never triggers.
    // This is Velora's actual behavior, not a Solvro invention.
    expect(formatIDRCompact(999_999_999)).toBe("Rp 1000jt");
  });

  it("switches to the 'M' tier exactly at 1 miliar, with a comma decimal separator", () => {
    expect(formatIDRCompact(1_000_000_000)).toBe("Rp 1,0M");
  });

  it("rounds to one decimal within the 'M' tier", () => {
    expect(formatIDRCompact(1_250_000_000)).toBe("Rp 1,3M");
  });

  it("has no dedicated triliun/'T' tier — a >= 1 triliun value renders as a large 'M' figure", () => {
    expect(formatIDRCompact(2_500_000_000_000)).toBe("Rp 2500,0M");
  });
});

describe("formatWinProbability", () => {
  it("renders 0%", () => {
    expect(formatWinProbability(0)).toBe("0%");
  });

  it("renders 100%", () => {
    expect(formatWinProbability(100)).toBe("100%");
  });

  it("rounds down a fractional probability below the half point", () => {
    expect(formatWinProbability(66.4)).toBe("66%");
  });

  it("rounds up a fractional probability at the half point", () => {
    expect(formatWinProbability(66.5)).toBe("67%");
  });
});

describe("STAGE_LABELS / STAGE_ORDER completeness", () => {
  const EXPECTED: Record<PipelineStage, string> = {
    ASSESSMENT: "Assessment",
    RFP: "RFP",
    POC: "PoC",
    TECHNICAL_CLARIFICATION: "Technical Clarification",
    DELIVER_PROPOSAL: "Delivered Proposal",
    WAITING_RESPONSE: "Waiting Response",
    WON: "Won",
    DROP: "Drop",
    HOLD: "Hold",
  };

  it("has exactly the 9 PipelineStage enum members as keys, with the expected labels", () => {
    expect(STAGE_LABELS).toEqual(EXPECTED);
  });

  it("orders the board with exactly the same 9 stages, no duplicates, matching the PRD order", () => {
    expect(STAGE_ORDER).toEqual([
      "ASSESSMENT",
      "RFP",
      "POC",
      "TECHNICAL_CLARIFICATION",
      "DELIVER_PROPOSAL",
      "WAITING_RESPONSE",
      "WON",
      "DROP",
      "HOLD",
    ]);
    expect(new Set(STAGE_ORDER).size).toBe(STAGE_ORDER.length);
  });

  it("keeps STAGE_LABELS and STAGE_ORDER in sync (every ordered stage has a label, and vice versa)", () => {
    expect(new Set(STAGE_ORDER)).toEqual(new Set(Object.keys(STAGE_LABELS)));
  });
});

describe("TERMINAL_STAGES", () => {
  it("is exactly WON and DROP, the single source of truth for both boardLogic.ts and kpi.ts", () => {
    expect(TERMINAL_STAGES).toEqual(["WON", "DROP"]);
  });
});

describe("formatPipelineDate", () => {
  it("renders a short Indonesian-locale date", () => {
    expect(formatPipelineDate("2026-06-30")).toBe("30 Jun 2026");
  });

  it("renders a single-digit day with no leading zero", () => {
    expect(formatPipelineDate("2026-01-05")).toBe("5 Jan 2026");
  });

  it("parses at local midnight (not UTC) so the calendar day never walks back a day", () => {
    // Regression guard for the `new Date(day)` trap this module's doc
    // comment calls out: parsed as UTC midnight, "2026-01-01" would render
    // as "31 Des 2025" in any timezone west of UTC. `dayToDate` avoids that
    // by construction, so this assertion holds in every host timezone.
    expect(formatPipelineDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("returns an empty string for an unparsable day", () => {
    expect(formatPipelineDate("not-a-date")).toBe("");
  });
});
