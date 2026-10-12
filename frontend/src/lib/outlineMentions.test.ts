import { describe, expect, it } from "vitest";
import {
  hiddenPagesCopy,
  mentionsTotal,
  unconnectedAction,
  unconnectedLead,
} from "./outlineMentions";

describe("mentionsTotal", () => {
  it("adds visible and hidden pages for a connected viewer", () => {
    expect(
      mentionsTotal({
        connected: true,
        visible: [{ docId: "a", title: "A", url: "https://x/doc/a" }],
        hiddenCount: 2,
      }),
    ).toBe(3);
  });

  it("uses the server's total for a viewer without a connection", () => {
    expect(mentionsTotal({ connected: false, total: 4 })).toBe(4);
  });

  it("is zero for an empty answer, connected or not", () => {
    expect(mentionsTotal({ connected: true, visible: [], hiddenCount: 0 })).toBe(0);
    expect(mentionsTotal({ connected: false, visible: [], hiddenCount: 0 })).toBe(0);
  });
});

describe("copy", () => {
  it("pluralises the hidden-pages row", () => {
    expect(hiddenPagesCopy(1)).toBe("1 more page you cannot open");
    expect(hiddenPagesCopy(3)).toBe("3 more pages you cannot open");
  });

  it("pluralises the unconnected sentence", () => {
    expect(unconnectedLead(1) + unconnectedAction(1)).toBe("Mentioned in 1 Outline page — connect Outline to see it");
    expect(unconnectedLead(5) + unconnectedAction(5)).toBe(
      "Mentioned in 5 Outline pages — connect Outline to see them",
    );
  });
});
