import { describe, expect, it } from "vitest";
import {
  commitDraft,
  dateToDay,
  dayFromIso,
  dayToDate,
  formatDisplay,
  isoFromDay,
  nextDraftFromSelection,
  normalizePair,
  pairFromRange,
  rangeFromPair,
} from "./dateField";

/**
 * Timezone-independence note: this suite must stay green under both
 * `TZ=UTC` and `TZ=Asia/Jakarta` (a positive/east-of-UTC offset — the zone
 * that exposed the picker walk-back bug this phase fixes, see
 * `dateField.ts`'s top comment). Run both to reproduce:
 * `docker compose exec frontend npm test` and
 * `docker compose exec -e TZ=Asia/Jakarta frontend npm test`.
 *
 * `dayToDate`/`dateToDay` operate purely on local Y/M/D — no ISO
 * round-trip, no `.toISOString()` — so their round-trips are trivially
 * TZ-independent and can be asserted directly. The ISO-touching helpers
 * (`dayFromIso`, `isoFromDay`) are now TZ-independent by construction too:
 * `isoFromDay` always derives UTC midnight from the day string and
 * `dayFromIso` always reads the UTC date-part back, so the two are exact
 * inverses of one another regardless of host timezone — see the
 * UTC-midnight invariant describe block below and `dateField.ts`'s doc.
 */
describe("dayToDate / dateToDay round-trip", () => {
  const sampleDays = [
    "2026-07-26",
    "2026-01-01",
    "2026-12-31",
    "2026-02-28",
    "2028-02-29", // leap day
  ];

  for (const day of sampleDays) {
    it(`round-trips ${day} through dayToDate -> dateToDay unchanged`, () => {
      const date = dayToDate(day);
      expect(date).not.toBeNull();
      const [y, m, d] = day.split("-").map(Number);
      expect(date!.getFullYear()).toBe(y);
      expect(date!.getMonth()).toBe(m - 1);
      expect(date!.getDate()).toBe(d);
      expect(date!.getHours()).toBe(0);
      expect(date!.getMinutes()).toBe(0);
      expect(date!.getSeconds()).toBe(0);

      expect(dateToDay(date)).toBe(day);
    });
  }

  it("dateToDay derives yyyy-MM-dd from LOCAL getters, not UTC getters", () => {
    const localMidnight = new Date(2026, 6, 26, 0, 0, 0); // July 26, 2026 local
    expect(dateToDay(localMidnight)).toBe("2026-07-26");
  });

  it("dateToDay discards a non-midnight time-of-day component", () => {
    const nonMidnight = new Date(2026, 6, 26, 23, 30);
    const midnight = new Date(2026, 6, 26, 0, 0, 0);
    expect(dateToDay(nonMidnight)).toBe(dateToDay(midnight));
    expect(dateToDay(nonMidnight)).toBe("2026-07-26");
  });
});

describe("DST-transition-adjacent dates round-trip to the same calendar day", () => {
  // EU DST transitions in 2026: spring-forward last Sunday of March (29th),
  // fall-back last Sunday of October (25th). Exercise the days immediately
  // surrounding each transition — these are exactly the dates most likely to
  // shift by one day if a UTC-based date path ever creeps back in.
  const dstAdjacentDays = [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
  ];

  for (const day of dstAdjacentDays) {
    it(`round-trips ${day} to the same local calendar day`, () => {
      const date = dayToDate(day);
      expect(date).not.toBeNull();
      expect(dateToDay(date)).toBe(day);
    });
  }
});

describe("null / empty / garbage input handling", () => {
  it("dayToDate(null) / dayToDate(\"\") return null", () => {
    expect(dayToDate(null)).toBeNull();
    expect(dayToDate("")).toBeNull();
  });

  it("dayToDate(garbage string) returns null", () => {
    expect(dayToDate("not-a-date")).toBeNull();
    expect(dayToDate("banana")).toBeNull();
    expect(dayToDate("2026-13-99")).toBeNull();
  });

  it("dateToDay(null) returns null", () => {
    expect(dateToDay(null)).toBeNull();
  });

  it("dateToDay(Invalid Date) returns null", () => {
    expect(dateToDay(new Date("garbage"))).toBeNull();
  });

  it("dayFromIso(null) / dayFromIso(\"\") return null", () => {
    expect(dayFromIso(null)).toBeNull();
    expect(dayFromIso("")).toBeNull();
  });

  it("isoFromDay(null) / isoFromDay(\"\") return null", () => {
    expect(isoFromDay(null)).toBeNull();
    expect(isoFromDay("")).toBeNull();
  });

  it("formatDisplay(null) returns empty string", () => {
    expect(formatDisplay(null)).toBe("");
  });
});

describe("formatDisplay", () => {
  it("formats a day string as dd/MM/yyyy", () => {
    expect(formatDisplay("2026-07-26")).toBe("26/07/2026");
  });

  it("zero-pads single-digit day and month", () => {
    expect(formatDisplay("2026-01-05")).toBe("05/01/2026");
  });

  it("returns empty string for null", () => {
    expect(formatDisplay(null)).toBe("");
  });

  it("returns empty string for garbage input", () => {
    expect(formatDisplay("not-a-date")).toBe("");
  });
});

describe("isoFromDay / dayFromIso: UTC-midnight canonical inverse invariant", () => {
  // Same day sets the rest of this suite already exercises for dayToDate/
  // dateToDay (sampleDays, incl. the leap day) and the DST-adjacent block
  // below — re-asserted here for the ISO boundary specifically.
  const sampleDays = [
    "2026-07-26",
    "2026-01-01",
    "2026-12-31",
    "2026-02-28",
    "2028-02-29", // leap day
  ];
  const dstAdjacentDays = [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
  ];
  const allDays = [...sampleDays, ...dstAdjacentDays];

  for (const day of allDays) {
    it(`isoFromDay(${day}) is exactly UTC midnight of that day`, () => {
      expect(isoFromDay(day)).toBe(`${day}T00:00:00.000Z`);
    });

    it(`dayFromIso(isoFromDay(${day})) round-trips back to ${day}`, () => {
      expect(dayFromIso(isoFromDay(day))).toBe(day);
    });
  }

  it("dayFromIso still derives the UTC date-part of an arbitrary (non-midnight) instant", () => {
    expect(dayFromIso("2026-07-26T15:42:07.123Z")).toBe("2026-07-26");
  });
});

describe("commitDraft", () => {
  it("untouched passthrough: draft unchanged from original returns the original ISO unchanged", () => {
    // Non-midnight fixture deliberately: for a midnight-UTC ISO,
    // isoFromDay(dayFromIso(iso)) === iso holds in every timezone now (not
    // just under a UTC system clock, as it did before this fix) — that
    // would make the passthrough branch unobservable with a midnight-UTC
    // fixture, since deleting the
    // `if (draftDay === dayFromIso(originalIso))` guard from commitDraft
    // would still round-trip to the same value. A non-midnight ISO keeps
    // its time-of-day component only via the passthrough, so deleting the
    // guard collapses it to UTC midnight of the same day and this
    // assertion goes red, in every zone.
    const originalIso = "2026-07-26T15:42:07.123Z";
    const draftDay = dayFromIso(originalIso); // "2026-07-26"
    expect(commitDraft(draftDay, originalIso)).toBe(originalIso);
  });

  it("untouched passthrough preserves a Gantt-written midnight-UTC ISO unchanged", () => {
    // The exact shape Gantt-authored Task.startDate/dueDate are always
    // written in ("yyyy-MM-ddT00:00:00.000Z") — kept as its own case so
    // that shape stays covered, even though (unlike the non-midnight case
    // above) this fixture alone can't distinguish the passthrough branch
    // from isoFromDay(dayFromIso(iso)), which now round-trips a
    // midnight-UTC instant unchanged in every timezone.
    const originalIso = "2026-07-26T00:00:00.000Z";
    const draftDay = dayFromIso(originalIso);
    expect(commitDraft(draftDay, originalIso)).toBe(originalIso);
  });

  it("untouched passthrough: null draft against null original returns null", () => {
    expect(commitDraft(null, null)).toBeNull();
  });

  it("untouched passthrough preserves byte-identity across repeated no-op commits: a non-midnight stored ISO never gets rewritten", () => {
    // Without the untouched-draft passthrough, re-deriving the ISO from the
    // day string on every save would silently rewrite a non-midnight
    // stored instant's time-of-day to UTC midnight the moment an untouched
    // form resaves — a regression visible in every timezone now that
    // `isoFromDay` is TZ-independent by construction (see the rationale in
    // the first passthrough test above). Simulate three "reopen and
    // re-save without touching anything" cycles and assert the stored ISO
    // never moves.
    let storedIso: string | null = "2026-07-26T15:42:07.123Z";
    for (let i = 0; i < 3; i++) {
      const draftDay = dayFromIso(storedIso);
      storedIso = commitDraft(draftDay, storedIso);
    }
    expect(storedIso).toBe("2026-07-26T15:42:07.123Z");
  });

  it("changed day: draft differing from the original's day commits via isoFromDay", () => {
    const originalIso = "2026-07-26T00:00:00.000Z";
    const changedDay = "2026-07-28";
    expect(commitDraft(changedDay, originalIso)).toBe(isoFromDay(changedDay));
    expect(commitDraft(changedDay, originalIso)).not.toBe(originalIso);
  });

  it("cleared day: draft null against a non-null original commits to null", () => {
    const originalIso = "2026-07-26T00:00:00.000Z";
    expect(commitDraft(null, originalIso)).toBeNull();
  });

  it("originalIso null + a freshly picked day commits via isoFromDay", () => {
    const pickedDay = "2026-07-28";
    expect(commitDraft(pickedDay, null)).toBe(isoFromDay(pickedDay));
    expect(commitDraft(pickedDay, null)).not.toBeNull();
  });

  it("originalIso null + no pick (draft stays null) stays null", () => {
    expect(commitDraft(null, null)).toBeNull();
  });
});

/**
 * `DateRangeField`'s draft-pair <-> react-day-picker `DateRange` mapping
 * (fix round, plan Task 3.5). `rangeFromPair` feeds `Calendar`'s `selected`
 * prop for DISPLAY only; `pairFromRange` reads `onSelect`'s argument back
 * into the draft pair. Apply itself never routes through either function —
 * it emits the draft pair verbatim — which is what the round-trip
 * describe-block below exists to justify.
 */
describe("rangeFromPair (draft pair -> RDP DateRange, display only)", () => {
  it("both null -> undefined (nothing highlighted)", () => {
    expect(rangeFromPair(null, null)).toBeUndefined();
  });

  it("due-only (start null, end set) -> a single-day range on the due date", () => {
    expect(rangeFromPair(null, "2026-07-30")).toEqual({
      from: dayToDate("2026-07-30"),
      to: dayToDate("2026-07-30"),
    });
  });

  it("start-only (end null) -> a single-day range on the start date", () => {
    expect(rangeFromPair("2026-07-26", null)).toEqual({
      from: dayToDate("2026-07-26"),
      to: dayToDate("2026-07-26"),
    });
  });

  it("both set -> {from, to}", () => {
    expect(rangeFromPair("2026-07-26", "2026-07-30")).toEqual({
      from: dayToDate("2026-07-26"),
      to: dayToDate("2026-07-30"),
    });
  });
});

describe("pairFromRange (RDP onSelect argument -> draft pair)", () => {
  it("undefined (RDP's re-click-to-deselect signal) -> both null", () => {
    expect(pairFromRange(undefined)).toEqual([null, null]);
  });

  it("{from, to: undefined} (RDP's to-less selection shape) -> both sides the same day", () => {
    const from = dayToDate("2026-07-26");
    expect(from).not.toBeNull();
    expect(pairFromRange({ from: from!, to: undefined })).toEqual([
      "2026-07-26",
      "2026-07-26",
    ]);
  });

  it("a completed {from, to} range -> the matching pair", () => {
    const from = dayToDate("2026-07-26");
    const to = dayToDate("2026-07-30");
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    expect(pairFromRange({ from: from!, to: to! })).toEqual(["2026-07-26", "2026-07-30"]);
  });
});

describe("rangeFromPair -> pairFromRange round-trip: why Apply can't emit an RDP-derived pair", () => {
  it("both null round-trips to both null", () => {
    expect(pairFromRange(rangeFromPair(null, null))).toEqual([null, null]);
  });

  it("a due-only pair does NOT round-trip through RDP's DateRange shape unchanged", () => {
    // This is the mechanism behind the due-only-task-wiped blocker this fix
    // round addresses: if the draft were RDP's DateRange object (seeded via
    // rangeFromPair, read back via pairFromRange) instead of the day-string
    // pair itself, a due-only task's null start would come back as the SAME
    // day as its due date on an untouched Apply — silently fabricating a
    // start date. The component never routes Apply through this round-trip
    // specifically to avoid this collapse; it emits draftStart/draftEnd
    // directly.
    const roundTripped = pairFromRange(rangeFromPair(null, "2026-07-30"));
    expect(roundTripped).toEqual(["2026-07-30", "2026-07-30"]);
    expect(roundTripped).not.toEqual([null, "2026-07-30"]);
  });

  it("a start-only pair does NOT round-trip through RDP's DateRange shape unchanged", () => {
    const roundTripped = pairFromRange(rangeFromPair("2026-07-26", null));
    expect(roundTripped).toEqual(["2026-07-26", "2026-07-26"]);
    expect(roundTripped).not.toEqual(["2026-07-26", null]);
  });

  it("a fully-set pair round-trips unchanged", () => {
    expect(pairFromRange(rangeFromPair("2026-07-26", "2026-07-30"))).toEqual([
      "2026-07-26",
      "2026-07-30",
    ]);
  });
});

/**
 * `DateRangeField`'s Apply-time ordering fix (fix round 2, plan Task 3.5,
 * SHOULD-FIX). `normalizePair` is what `handleApply` calls before emitting,
 * so an inverted stored pair (`startDate > dueDate` — nothing upstream
 * enforces ordering) doesn't silently commit a still- or newly-inverted
 * result. Critically, it must NOT touch a draft the user never changed, even
 * when that untouched draft is itself inverted — see the "untouched" cases
 * below, which exist specifically to protect `commitDraft`'s
 * untouched-passthrough byte-parity at the caller.
 */
describe("normalizePair (Apply-time ordering fix for a changed draft)", () => {
  it("an already-ordered pair, changed from its seed, stays ordered", () => {
    expect(normalizePair("2026-07-10", "2026-07-20", "2026-07-01", "2026-07-02")).toEqual([
      "2026-07-10",
      "2026-07-20",
    ]);
  });

  it("an inverted pair, changed from its seed, swaps to ordered", () => {
    expect(normalizePair("2026-07-20", "2026-07-10", "2026-07-01", "2026-07-02")).toEqual([
      "2026-07-10",
      "2026-07-20",
    ]);
  });

  it("a one-sided draft (end null), changed from its seed, is untouched by the swap logic", () => {
    expect(normalizePair("2026-07-20", null, "2026-07-01", "2026-07-02")).toEqual([
      "2026-07-20",
      null,
    ]);
  });

  it("a one-sided draft (start null), changed from its seed, is untouched by the swap logic", () => {
    expect(normalizePair(null, "2026-07-20", "2026-07-01", "2026-07-02")).toEqual([
      null,
      "2026-07-20",
    ]);
  });

  it("a both-null draft, changed from its seed, is untouched by the swap logic", () => {
    expect(normalizePair(null, null, "2026-07-01", "2026-07-02")).toEqual([null, null]);
  });

  it("a same-day pair (milestone shape), changed from its seed, is untouched — not inverted", () => {
    expect(normalizePair("2026-07-15", "2026-07-15", "2026-07-01", "2026-07-02")).toEqual([
      "2026-07-15",
      "2026-07-15",
    ]);
  });

  it("UNTOUCHED passthrough: draft identical to an inverted seed emits the seed verbatim, unswapped", () => {
    // This is the guard the "changed" check exists for: an open->Apply with
    // zero calendar interaction on a task whose stored startDate/dueDate are
    // already inverted must reproduce those exact values, not a
    // newly-ordered pair the user never asked for — otherwise
    // commitDraft's untouched-passthrough at the call site would see a
    // "changed" draft and re-derive the ISO, breaking byte-parity.
    expect(normalizePair("2026-07-20", "2026-07-10", "2026-07-20", "2026-07-10")).toEqual([
      "2026-07-20",
      "2026-07-10",
    ]);
  });

  it("UNTOUCHED passthrough: an ordered, unchanged draft is also returned verbatim", () => {
    expect(normalizePair("2026-07-10", "2026-07-20", "2026-07-10", "2026-07-20")).toEqual([
      "2026-07-10",
      "2026-07-20",
    ]);
  });

  it("UNTOUCHED passthrough: both-null draft against both-null seed stays both null", () => {
    expect(normalizePair(null, null, null, null)).toEqual([null, null]);
  });

  it("only START edited into inversion, END left at its seed value — the RDP-reachable path — pins the `changed` guard's `||`", () => {
    // A `&&` typo (or a guard that only ever checks `draftStart !==
    // seedStart`, dropping the END side) would evaluate `changed` false
    // here, since `draftEnd === seedEnd`, and skip the swap entirely —
    // returning the still-inverted `[draftStart, draftEnd]` instead of the
    // ordered pair asserted below.
    // only START edited into inversion — the RDP-reachable path
    expect(normalizePair("2026-09-15", "2026-09-10", "2026-09-20", "2026-09-10")).toEqual([
      "2026-09-10",
      "2026-09-15",
    ]);
  });

  it("only END edited into inversion, START left at its seed value — pins the symmetric branch of the `||`", () => {
    // The mirror image of the case above: a `&&` typo (or a guard that only
    // ever checks `draftEnd !== seedEnd`, dropping the START side) would
    // evaluate `changed` false here, since `draftStart === seedStart`, and
    // skip the swap.
    // only END edited into inversion — pins the symmetric branch
    expect(normalizePair("2026-09-20", "2026-09-05", "2026-09-20", "2026-09-25")).toEqual([
      "2026-09-05",
      "2026-09-20",
    ]);
  });
});

/**
 * `DateRangeField`'s `onSelect` boundary (fix round 3, plan Task 3.5 polish).
 * `nextDraftFromSelection` is what `handleSelect` now calls through — a
 * one-line delegation, see `DateRangeField.tsx`. Its whole job is ignoring
 * RDP's own re-click-to-DESELECT signal (`range === undefined`) rather than
 * routing it through `pairFromRange` (which would map it to both-null).
 */
describe("nextDraftFromSelection (onSelect boundary: ignores RDP's deselect signal)", () => {
  it("range undefined: returns `current` unchanged, by both value-equality AND identity", () => {
    const current: [string | null, string | null] = ["2026-07-26", "2026-07-30"];
    const result = nextDraftFromSelection(undefined, current);
    expect(result).toBe(current); // identity — not a new array with equal contents
    expect(result).toEqual(current); // value-equality, redundant with toBe here but explicit
  });

  it("range undefined with a one-sided current draft: still returns `current` unchanged — this is the load-bearing case", () => {
    // Ignoring `undefined` here (rather than mapping it through
    // pairFromRange to [null, null]) is what stops a click on a one-sided
    // draft's — or ANY milestone task's, since the backend forces
    // `startDate === dueDate` (see `tasks.ts`'s milestone lockstep) — single
    // highlighted day from silently wiping the draft. `rangeFromPair`
    // fabricates a same-day `{from: D, to: D}` `selected` for both a
    // one-sided draft and a genuine same-day (milestone) pair, so clicking
    // that single highlighted day is an entirely ordinary interaction that
    // fires RDP's re-click-to-deselect signal, not a rare edge case. If this
    // function returned `pairFromRange(undefined)` (`[null, null]`) instead
    // of `current` here, the very next Apply would silently commit a
    // double-null wipe of a due-only/start-only task or a milestone.
    const current: [string | null, string | null] = [null, "2026-07-30"];
    expect(nextDraftFromSelection(undefined, current)).toBe(current);
  });

  it("a defined, fully-set range maps exactly as pairFromRange does", () => {
    const from = dayToDate("2026-07-26");
    const to = dayToDate("2026-07-30");
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    const range = { from: from!, to: to! };
    expect(nextDraftFromSelection(range, [null, null])).toEqual(pairFromRange(range));
    expect(nextDraftFromSelection(range, [null, null])).toEqual(["2026-07-26", "2026-07-30"]);
  });

  it("a defined, to-less range maps exactly as pairFromRange does (collapses to a same-day pair)", () => {
    const from = dayToDate("2026-07-26");
    expect(from).not.toBeNull();
    const range = { from: from!, to: undefined };
    expect(nextDraftFromSelection(range, [null, null])).toEqual(pairFromRange(range));
    expect(nextDraftFromSelection(range, [null, null])).toEqual(["2026-07-26", "2026-07-26"]);
  });
});
