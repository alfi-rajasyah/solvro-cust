import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { actionLabel, availableActions, RESOLUTION_CODES, teamsFromError } from "./ticketActions";

describe("availableActions", () => {
  it("offers Assign to me on a new ticket", () => {
    expect(availableActions("new")).toEqual(["assign_to_me"]);
  });

  it("offers Pending and Resolve on an assigned ticket", () => {
    expect(availableActions("assigned")).toEqual(["pending", "resolve"]);
  });

  it("offers Assign to me and Resolve on a pending ticket — ev_assign is also valid from pending on a real iTop install", () => {
    expect(availableActions("pending")).toEqual(["assign_to_me", "resolve"]);
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

describe("teamsFromError", () => {
  it("extracts teams from a 409 itop_team_required refusal", () => {
    const teams = [{ id: 1, name: "Service Desk" }, { id: 2, name: "NOC" }];
    const err = new ApiError(409, "iTop needs a team.", {
      code: "itop_team_required",
      details: { teams },
    });
    expect(teamsFromError(err)).toEqual(teams);
  });

  it("is null for a 409 with a different code", () => {
    const err = new ApiError(409, "conflict", { code: "itop_refused" });
    expect(teamsFromError(err)).toBeNull();
  });

  it("is null for a non-409 ApiError", () => {
    const err = new ApiError(500, "boom", null);
    expect(teamsFromError(err)).toBeNull();
  });

  it("is null for a 409 missing the teams detail", () => {
    const err = new ApiError(409, "iTop needs a team.", { code: "itop_team_required" });
    expect(teamsFromError(err)).toBeNull();
  });

  it("is null for a non-ApiError throw", () => {
    expect(teamsFromError(new Error("network down"))).toBeNull();
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
