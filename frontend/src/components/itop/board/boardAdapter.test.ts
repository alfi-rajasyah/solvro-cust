import { describe, expect, it } from "vitest";
import type { ItopTicketRow } from "@/lib/queries";
import { BOARD_COLUMNS, foldedStatusLabel, isEscalated, ticketsToColumns } from "./boardAdapter";

function ticket(overrides: Partial<ItopTicketRow> & Pick<ItopTicketRow, "id" | "status">): ItopTicketRow {
  return {
    class: "UserRequest",
    ref: `R-${overrides.id}`,
    title: `Ticket ${overrides.id}`,
    operationalStatus: "ongoing",
    priority: "3",
    agentPersonId: null,
    agentName: null,
    teamName: null,
    serviceName: null,
    callerName: null,
    startDate: "2026-09-20T00:00:00.000Z",
    lastUpdate: "2026-09-22T00:00:00.000Z",
    tto: null,
    ttr: null,
    slaTtoPassed: false,
    slaTtrPassed: false,
    resolutionDate: null,
    isMine: false,
    ...overrides,
  };
}

describe("ticketsToColumns", () => {
  it("always produces all 5 columns, in order, even when empty", () => {
    const columns = ticketsToColumns([]);
    expect(Object.keys(columns)).toEqual([...BOARD_COLUMNS]);
    for (const col of BOARD_COLUMNS) expect(columns[col]).toEqual([]);
  });

  it("buckets new/assigned/pending/resolved/closed by their own status", () => {
    const tickets = [
      ticket({ id: 1, status: "new" }),
      ticket({ id: 2, status: "assigned" }),
      ticket({ id: 3, status: "pending" }),
      ticket({ id: 4, status: "resolved" }),
      ticket({ id: 5, status: "closed" }),
    ];
    const columns = ticketsToColumns(tickets);
    expect(columns.new.map((t) => t.id)).toEqual([1]);
    expect(columns.assigned.map((t) => t.id)).toEqual([2]);
    expect(columns.pending.map((t) => t.id)).toEqual([3]);
    expect(columns.resolved.map((t) => t.id)).toEqual([4]);
    expect(columns.closed.map((t) => t.id)).toEqual([5]);
  });

  it("folds escalated_tto/escalated_ttr into assigned, never a dedicated column", () => {
    const tickets = [
      ticket({ id: 1, status: "escalated_tto" }),
      ticket({ id: 2, status: "escalated_ttr" }),
    ];
    const columns = ticketsToColumns(tickets);
    expect(columns.assigned.map((t) => t.id).sort()).toEqual([1, 2]);
    expect(columns.new).toEqual([]);
    expect(columns.pending).toEqual([]);
  });

  it("folds waiting_for_approval/approved/rejected and unknown statuses into assigned", () => {
    const tickets = [
      ticket({ id: 1, status: "waiting_for_approval" }),
      ticket({ id: 2, status: "approved" }),
      ticket({ id: 3, status: "rejected" }),
      ticket({ id: 4, status: "some_future_status" }),
    ];
    const columns = ticketsToColumns(tickets);
    expect(columns.assigned.map((t) => t.id).sort()).toEqual([1, 2, 3, 4]);
  });

  it("dedupes by id (last occurrence wins) when the same ticket appears twice", () => {
    const tickets = [ticket({ id: 1, status: "new" }), ticket({ id: 1, status: "assigned" })];
    const columns = ticketsToColumns(tickets);
    expect(columns.new).toEqual([]);
    expect(columns.assigned.map((t) => t.id)).toEqual([1]);
  });

  it("sorts breached/escalated tickets first, then by lastUpdate desc", () => {
    const older = ticket({ id: 1, status: "assigned", lastUpdate: "2026-09-20T00:00:00.000Z" });
    const newer = ticket({ id: 2, status: "assigned", lastUpdate: "2026-09-22T00:00:00.000Z" });
    const breached = ticket({
      id: 3,
      status: "assigned",
      lastUpdate: "2026-09-01T00:00:00.000Z",
      slaTtrPassed: true,
    });
    const columns = ticketsToColumns([older, newer, breached]);
    expect(columns.assigned.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it("sorts an escalated ticket ahead of a non-breached one even if older", () => {
    const escalated = ticket({
      id: 1,
      status: "escalated_ttr",
      lastUpdate: "2026-09-01T00:00:00.000Z",
    });
    const recent = ticket({ id: 2, status: "assigned", lastUpdate: "2026-09-22T00:00:00.000Z" });
    const columns = ticketsToColumns([recent, escalated]);
    expect(columns.assigned.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("isEscalated", () => {
  it("is true only for escalated_tto/escalated_ttr", () => {
    expect(isEscalated({ status: "escalated_tto" })).toBe(true);
    expect(isEscalated({ status: "escalated_ttr" })).toBe(true);
    expect(isEscalated({ status: "assigned" })).toBe(false);
    expect(isEscalated({ status: "pending" })).toBe(false);
  });
});

describe("foldedStatusLabel", () => {
  it("is null for a genuine assigned or escalated ticket", () => {
    expect(foldedStatusLabel({ status: "assigned" })).toBeNull();
    expect(foldedStatusLabel({ status: "escalated_tto" })).toBeNull();
    expect(foldedStatusLabel({ status: "escalated_ttr" })).toBeNull();
  });

  it("is null for statuses with their own dedicated column", () => {
    expect(foldedStatusLabel({ status: "new" })).toBeNull();
    expect(foldedStatusLabel({ status: "pending" })).toBeNull();
    expect(foldedStatusLabel({ status: "resolved" })).toBeNull();
    expect(foldedStatusLabel({ status: "closed" })).toBeNull();
  });

  it("labels waiting_for_approval/approved/rejected", () => {
    expect(foldedStatusLabel({ status: "waiting_for_approval" })).toBe("iTop: waiting for approval");
    expect(foldedStatusLabel({ status: "approved" })).toBe("iTop: approved");
    expect(foldedStatusLabel({ status: "rejected" })).toBe("iTop: rejected");
  });

  it("labels an unrecognized status by its raw value", () => {
    expect(foldedStatusLabel({ status: "some_future_status" })).toBe("iTop: some_future_status");
  });
});
