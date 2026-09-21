import { describe, expect, it } from "vitest";
import {
  extractDataRows,
  IMPORTABLE_STAGES,
  parseDealValueCell,
  parseExcelDate,
  parseImportRow,
} from "./importParse";

describe("IMPORTABLE_STAGES", () => {
  it("excludes HOLD — reachable only via the board's move flow, never on import", () => {
    expect(IMPORTABLE_STAGES).not.toContain("HOLD");
  });

  it("includes every other PipelineStage", () => {
    expect(IMPORTABLE_STAGES).toEqual([
      "ASSESSMENT",
      "RFP",
      "POC",
      "TECHNICAL_CLARIFICATION",
      "DELIVER_PROPOSAL",
      "WAITING_RESPONSE",
      "WON",
      "DROP",
    ]);
  });
});

describe("parseExcelDate", () => {
  it("parses a DD/MM/YYYY string into a yyyy-MM-dd day string", () => {
    expect(parseExcelDate("30/06/2026")).toBe("2026-06-30");
  });

  it("pads single-digit day/month", () => {
    expect(parseExcelDate("5/6/2026")).toBe("2026-06-05");
  });

  it("parses an Excel serial date number (UTC-based, no timezone of its own)", () => {
    // Excel serial 46000 = 2025-12-09 (25569 = the Excel serial for the Unix
    // epoch 1970-01-01; (46000 - 25569) days past it).
    expect(parseExcelDate(46000)).toBe("2025-12-09");
  });

  it("passes through an ISO-ish 'yyyy-MM-dd...' string via its date part", () => {
    expect(parseExcelDate("2026-06-30T00:00:00.000Z")).toBe("2026-06-30");
  });

  it("returns null for empty/null/undefined input", () => {
    expect(parseExcelDate("")).toBeNull();
    expect(parseExcelDate(null)).toBeNull();
    expect(parseExcelDate(undefined)).toBeNull();
  });

  it("returns null for an unparsable string", () => {
    expect(parseExcelDate("not a date")).toBeNull();
  });
});

describe("parseDealValueCell", () => {
  it("parses a plain digit string", () => {
    expect(parseDealValueCell("500000000")).toBe(500000000);
  });

  it("parses an Indonesian-grouped value ('1.500.000.000') as 1,500,000,000, not 1.5 (S2)", () => {
    expect(parseDealValueCell("1.500.000.000")).toBe(1500000000);
  });

  it("parses a single grouped separator ('1.500') as 1500, the Indonesian thousands convention", () => {
    expect(parseDealValueCell("1.500")).toBe(1500);
  });

  it("treats a non-3-digit trailing group as a decimal fraction ('1.500,75' -> 1500.75)", () => {
    expect(parseDealValueCell("1.500,75")).toBe(1500.75);
  });

  it("rejects a non-3-digit MIDDLE group as ambiguous rather than guessing ('1.50.000')", () => {
    expect(parseDealValueCell("1.50.000")).toBeNull();
  });

  it("preserves a leading minus instead of stripping it", () => {
    expect(parseDealValueCell("-5000")).toBe(-5000);
  });

  it("strips a currency prefix/spaces around the digits", () => {
    expect(parseDealValueCell("Rp 500.000")).toBe(500000);
  });

  it("returns null for a blank cell (caller decides blank semantics)", () => {
    expect(parseDealValueCell("")).toBeNull();
    expect(parseDealValueCell("   ")).toBeNull();
  });

  it("returns null for non-numeric junk", () => {
    expect(parseDealValueCell("not a number")).toBeNull();
  });
});

describe("extractDataRows", () => {
  const header = ["Title", "Company", "Deal Value", "Stage", "PIC", "Deadline", "Product / Solution", "Win Probability", "Lead Source", "Activity Log"];
  const dataRow1 = ["Implementasi ERP", "PT. Maju Jaya", "500000000", "assessment", "", "30/06/2026", "ERP", "70", "Referral", ""];
  const dataRow2 = ["Website Revamp", "PT. Sinar", "100000000", "rfp", "", "", "", "", "", ""];

  it("drops the header row", () => {
    const result = extractDataRows([header, dataRow1]);
    expect(result).toEqual([dataRow1]);
  });

  it("drops note rows (first cell starts with '*')", () => {
    const noteRow = ["* Valid stages: assessment, rfp", "", "", "", "", "", "", "", "", ""];
    const result = extractDataRows([header, dataRow1, noteRow]);
    expect(result).toEqual([dataRow1]);
  });

  it("drops fully-blank rows", () => {
    const blankRow = ["", "", "", "", "", "", "", "", "", ""];
    const result = extractDataRows([header, dataRow1, blankRow, dataRow2]);
    expect(result).toEqual([dataRow1, dataRow2]);
  });

  it("returns an empty array for a header-only sheet", () => {
    expect(extractDataRows([header])).toEqual([]);
  });
});

describe("parseImportRow", () => {
  const noPics = new Map<string, number>();
  const validCells = [
    "Implementasi ERP",
    "PT. Maju Jaya",
    "500000000",
    "assessment",
    "Budi Santoso",
    "30/06/2026",
    "ERP Implementation",
    "70",
    "Referral",
    "Initial meeting done",
  ];

  it("parses a fully valid row with status 'valid' and no errors", () => {
    const picByUsername = new Map([["budi santoso", 7]]);
    const row = parseImportRow(validCells, 0, picByUsername);
    expect(row).toMatchObject({
      rowNum: 2,
      title: "Implementasi ERP",
      customerName: "PT. Maju Jaya",
      dealValue: 500000000,
      stage: "ASSESSMENT",
      picName: "Budi Santoso",
      picId: 7,
      deadline: "2026-06-30",
      productSolution: "ERP Implementation",
      winProbability: 70,
      leadSource: "Referral",
      activityLog: "Initial meeting done",
      status: "valid",
      errors: [],
    });
  });

  it("derives rowNum as idx + 2 (accounts for the header row)", () => {
    expect(parseImportRow(validCells, 5, noPics).rowNum).toBe(7);
  });

  it("flags a missing title as invalid", () => {
    const cells = [...validCells];
    cells[0] = "";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors).toContain("Title is required.");
  });

  it("flags a missing company as invalid", () => {
    const cells = [...validCells];
    cells[1] = "";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors).toContain("Company is required.");
  });

  it("flags a non-numeric deal value as invalid", () => {
    const cells = [...validCells];
    cells[2] = "not a number";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors.some((e) => e.includes("Deal Value"))).toBe(true);
  });

  it("defaults a blank Deal Value to 0 without invalidating the row (N3, server parity)", () => {
    const cells = [...validCells];
    cells[2] = "";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.dealValue).toBe(0);
    expect(row.status).toBe("valid");
  });

  it("parses an Indonesian-grouped Deal Value ('1.500.000.000') as 1,500,000,000, not 1.5 (S2)", () => {
    const cells = [...validCells];
    cells[2] = "1.500.000.000";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.dealValue).toBe(1500000000);
    expect(row.status).toBe("valid");
  });

  it("rejects an ambiguous grouped Deal Value ('1.50.000') as invalid rather than guessing (S2)", () => {
    const cells = [...validCells];
    cells[2] = "1.50.000";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors.some((e) => e.includes("Deal Value"))).toBe(true);
  });

  it("does not silently strip a leading minus — a negative Deal Value fails the >= 0 check (S2)", () => {
    const cells = [...validCells];
    cells[2] = "-5000";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors.some((e) => e.includes("Deal Value"))).toBe(true);
  });

  it("flags an unrecognized stage as invalid, listing the accepted set", () => {
    const cells = [...validCells];
    cells[3] = "not_a_stage";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors.some((e) => e.startsWith('Invalid stage "not_a_stage"'))).toBe(true);
  });

  it("rejects 'hold' as an import-time stage (reachable only via the board's move flow)", () => {
    const cells = [...validCells];
    cells[3] = "hold";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
  });

  it("normalizes a stage token regardless of case/spacing", () => {
    const cells = [...validCells];
    cells[3] = "Deliver Proposal";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.stage).toBe("DELIVER_PROPOSAL");
    expect(row.status).toBe("valid");
  });

  it("defaults a blank win probability to 50 without invalidating the row", () => {
    const cells = [...validCells];
    cells[7] = "";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.winProbability).toBe(50);
    expect(row.status).toBe("valid");
  });

  it("flags a win probability outside 0-100 as invalid", () => {
    const cells = [...validCells];
    cells[7] = "150";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors.some((e) => e.includes("Win Probability"))).toBe(true);
  });

  it("leaves picId null for an unmatched PIC name WITHOUT invalidating the row", () => {
    const row = parseImportRow(validCells, 0, noPics);
    expect(row.picId).toBeNull();
    expect(row.picName).toBe("Budi Santoso");
    expect(row.status).toBe("valid");
  });

  it("matches a PIC name case-insensitively", () => {
    const picByUsername = new Map([["budi santoso", 7]]);
    const cells = [...validCells];
    cells[4] = "BUDI SANTOSO";
    const row = parseImportRow(cells, 0, picByUsername);
    expect(row.picId).toBe(7);
  });

  it("leaves picId null when no PIC name is given at all", () => {
    const cells = [...validCells];
    cells[4] = "";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.picId).toBeNull();
    expect(row.picName).toBe("");
  });

  it("parses a blank deadline as null without invalidating the row", () => {
    const cells = [...validCells];
    cells[5] = "";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.deadline).toBeNull();
    expect(row.status).toBe("valid");
  });

  it("flags an unparseable non-empty deadline as invalid (S1)", () => {
    const cells = [...validCells];
    cells[5] = "not a date";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors).toContain("Deadline must be DD/MM/YYYY.");
  });

  it("flags an impossible month ('31/13/2026') as invalid rather than passing '2026-13-31' through (S1)", () => {
    const cells = [...validCells];
    cells[5] = "31/13/2026";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors).toContain("Deadline must be DD/MM/YYYY.");
  });

  it("flags an impossible day-for-month ('30/02/2026', not a leap day) as invalid (S1)", () => {
    const cells = [...validCells];
    cells[5] = "30/02/2026";
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors).toContain("Deadline must be DD/MM/YYYY.");
  });

  it("accumulates multiple errors for a row with several problems", () => {
    const cells = ["", "", "not a number", "bogus_stage", "", "", "", "999", "", ""];
    const row = parseImportRow(cells, 0, noPics);
    expect(row.status).toBe("invalid");
    expect(row.errors.length).toBeGreaterThanOrEqual(4);
  });
});
