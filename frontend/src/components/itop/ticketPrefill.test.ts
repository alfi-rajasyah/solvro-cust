import { describe, expect, it } from "vitest";
import { buildTicketPrefill } from "./ticketPrefill";

describe("buildTicketPrefill", () => {
  it("appends a project context line to a top-level task", () => {
    expect(buildTicketPrefill({ title: "T", description: "Body", projectName: "P" })).toEqual({
      title: "T",
      description: "Body\n\nSolvro: P › T",
    });
  });

  it("appends a context line after a subtask's description", () => {
    expect(buildTicketPrefill({ title: "Configure VPN", description: "Do it", projectName: "Core DR", parentTitle: "Parent" })).toEqual({
      title: "Configure VPN",
      description: "Do it\n\nSolvro: Core DR › Parent › Configure VPN",
    });
  });

  it("uses the context line alone when a subtask has no description", () => {
    expect(buildTicketPrefill({ title: "X", description: null, projectName: "P", parentTitle: "Parent" }).description).toBe(
      "Solvro: P › Parent › X",
    );
  });
});
