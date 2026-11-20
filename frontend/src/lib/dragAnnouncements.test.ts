import { describe, expect, it } from "vitest";
import { buildBoardAnnouncements } from "./dragAnnouncements";

const cards: Record<string, { label: string; col: string }> = {
  "57": { label: "Write the brief", col: "To do" },
  "58": { label: "Review draft", col: "Done" },
};
const cols: Record<string, string> = { "col-1": "To do", "col-3": "Done" };

const make = (forbid = false) =>
  buildBoardAnnouncements({
    cardLabel: (id) => cards[String(id)]?.label ?? null,
    columnLabelOf: (id) => cols[String(id)] ?? cards[String(id)]?.col ?? null,
    isForbiddenTarget: forbid ? () => true : undefined,
  });

const ev = (active: string, over?: string) =>
  ({
    active: { id: active },
    over: over ? { id: over } : null,
  }) as never;

describe("buildBoardAnnouncements", () => {
  it("names the card and its column, never the raw id", () => {
    const a = make();
    expect(a.onDragStart?.(ev("57"))).toBe("Picked up Write the brief from To do.");
    expect(a.onDragOver?.(ev("57", "col-3"))).toBe("Write the brief is over Done.");
    expect(a.onDragOver?.(ev("57", "58"))).toBe("Write the brief is over Review draft in Done.");
    expect(a.onDragOver?.(ev("57", "57"))).toBe("Write the brief is over To do.");
    expect(a.onDragEnd?.(ev("57", "col-3"))).toBe("Write the brief was dropped over Done.");
    expect(a.onDragCancel?.(ev("57"))).toBe("Move cancelled. Write the brief stays where it was.");
  });

  it("says when the target is not allowed", () => {
    const a = make(true);
    expect(a.onDragOver?.(ev("57", "col-3"))).toContain("Not an allowed move");
    expect(a.onDragEnd?.(ev("57", "col-3"))).toContain("Nothing changed");
  });

  it("handles a drop outside any column", () => {
    expect(make().onDragEnd?.(ev("57"))).toBe("Write the brief was dropped. Nothing changed.");
  });

  it("handles over null and unknown cards", () => {
    const a = make();
    expect(a.onDragOver?.(ev("57"))).toBe("Write the brief is not over a column.");
    expect(a.onDragStart?.(ev("999"))).toBe("Picked up card.");
    expect(a.onDragOver?.(ev("999", "col-1"))).toBe("card is over To do.");
  });

  it("flags a forbidden target reached over a card", () => {
    expect(make(true).onDragOver?.(ev("57", "58"))).toBe(
      "Write the brief is over Review draft in Done. Not an allowed move.",
    );
  });

  it("uses a drop outcome when the board supplies one", () => {
    const a = buildBoardAnnouncements({
      cardLabel: () => "R-1",
      columnLabelOf: () => "Pending",
      dropOutcome: () => "waits for confirmation.",
    });
    expect(a.onDragEnd?.(ev("1", "2"))).toBe("R-1 waits for confirmation.");
  });
});
