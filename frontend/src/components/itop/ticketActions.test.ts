import { describe, expect, it } from "vitest";
import { actionLabel, availableActions, RESOLUTION_CODES } from "./ticketActions";

describe("availableActions", () => {
  it("offers Assign to me on a new ticket", () => {
    expect(availableActions("new")).toEqual(["assign_to_me"]);
  });

  it("offers Pending and Resolve on an assigned ticket", () => {
    expect(availableActions("assigned")).toEqual(["pending", "resolve"]);
  });

  it("offers Resolve and Assign to me on a pending ticket", () => {
    expect(availableActions("pending")).toEqual(["resolve", "assign_to_me"]);
  });

  it("offers Close and Reopen on a resolved ticket", () => {
    expect(availableActions("resolved")).toEqual(["close", "reopen"]);
  });

  it("offers nothing on a closed ticket", () => {
    expect(availableActions("closed")).toEqual([]);
  });

  it("offers Pending and Resolve on an escalated ticket, same as assigned", () => {
    expect(availableActions("escalated_tto")).toEqual(["pending", "resolve"]);
    expect(availableActions("escalated_ttr")).toEqual(["pending", "resolve"]);
  });

  it("offers nothing for an unknown status", () => {
    expect(availableActions("some_future_status")).toEqual([]);
  });
});

describe("actionLabel", () => {
  it("labels every action", () => {
    expect(actionLabel("assign_to_me")).toBe("Assign to me");
    expect(actionLabel("pending")).toBe("Pending");
    expect(actionLabel("resolve")).toBe("Resolve");
    expect(actionLabel("close")).toBe("Close");
    expect(actionLabel("reopen")).toBe("Reopen");
  });
});

describe("RESOLUTION_CODES", () => {
  it("includes iTop's default codes", () => {
    const values = RESOLUTION_CODES.map((c) => c.value);
    expect(values).toEqual([
      "assistance",
      "bug fixed",
      "hardware repair",
      "software patch",
      "system update",
      "training",
      "other",
    ]);
  });

  it("gives every code a human label", () => {
    for (const c of RESOLUTION_CODES) {
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});
