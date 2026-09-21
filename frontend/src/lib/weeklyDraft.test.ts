import { describe, expect, it } from "vitest";
import { draftWeeklyAchievements, draftWeeklyHighlights, splitTitle } from "./weeklyDraft";
import type {
  DailyReviewCustomer,
  DailyReviewNote,
  DailyReviewOpsNote,
  DailyReviewProject,
  WeeklyHighlight,
  WeeklyUpdate,
} from "./queries";

// A full ISO week (Mon..Sun) matching backend/test/isoWeek.test.ts and
// isoWeek.test.ts's shared "2026-W35" fixture — Mon 24 ... Sun 30.
const WEEK = {
  days: [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ],
};

const AUTHOR = { id: 1, username: "alice" };

// `noteDate` is built as a full ISO instant ("2026-08-24T00:00:00.000Z"),
// matching what the API actually returns for every `@db.Date` column (see
// backend/test/projectReviews.test.ts) — this is the shape every test below
// exercises by default. `weeklyDraft.ts`'s `groupNotesByDay` reads the
// calendar day out of it via `dayFromIso`; see the one bare-day-string case
// near the bottom of this file proving that shape also still works.
function note(id: number, day: string, body: string): DailyReviewNote {
  return {
    id,
    noteDate: `${day}T00:00:00.000Z`,
    body,
    author: AUTHOR,
    updatedAt: `${day}T12:00:00.000Z`,
  };
}

function opsNote(id: number, day: string, body: string, title: string): DailyReviewOpsNote {
  return {
    ...note(id, day, body),
    title,
  };
}

function project(id: number, name: string, notes: DailyReviewNote[]): DailyReviewProject {
  return {
    id,
    name,
    status: "ACTIVE",
    customerId: 1,
    baselineLockedAt: null,
    phase: "—",
    progress: { done: 0, total: 0 },
    slipDays: null,
    overdueTasks: [],
    openRisks: [],
    notes,
    reviews: [],
  };
}

// One saved WeeklyHighlight row, for a customer's `weeklyUpdate.highlights`
// (draftWeeklyAchievements' D9 input, not the note-drafted output).
function savedHighlight(id: number, title: string, detail: string | null = null): WeeklyHighlight {
  return { id, position: id, title, detail, risk: null, action: null };
}

function weeklyUpdateWithHighlights(highlights: WeeklyHighlight[]): WeeklyUpdate {
  return {
    id: 1,
    weekStart: `${WEEK.days[0]}T00:00:00.000Z`,
    health: null,
    status: "DRAFT",
    doneAt: null,
    category: null,
    highlights,
    achievements: [],
    midweekSavedAt: null,
    author: AUTHOR,
    updatedAt: `${WEEK.days[0]}T00:00:00.000Z`,
  };
}

function customer(
  projects: DailyReviewProject[],
  operationsNotes: DailyReviewOpsNote[] = [],
  weeklyUpdate: DailyReviewCustomer["weeklyUpdate"] = null,
): DailyReviewCustomer {
  return {
    id: 1,
    name: "Acme",
    tam: { id: 1, username: "alice" },
    projects,
    operationsNotes,
    weeklyUpdate,
    previousWeeklyUpdate: null,
  };
}

describe("splitTitle", () => {
  it("takes the first line as the title and the rest, trimmed, as detail", () => {
    expect(splitTitle("Line one\nLine two\nLine three")).toEqual({
      title: "Line one",
      detail: "Line two\nLine three",
    });
  });

  it("a single-line body has a null detail", () => {
    expect(splitTitle("Just one line")).toEqual({ title: "Just one line", detail: null });
  });

  it("cuts a first line over 200 characters at 200 and puts the full trimmed text in detail", () => {
    const longLine = "x".repeat(210);
    const body = `${longLine}\nmore text`;

    const { title, detail } = splitTitle(body);

    expect(title).toBe(longLine.slice(0, 200));
    expect(title.length).toBe(200);
    expect(detail).toBe(body);
  });

  it("normalises \\r\\n line endings to \\n throughout, in both title and detail", () => {
    expect(splitTitle("Title line\r\nRest one\r\nRest two")).toEqual({
      title: "Title line",
      detail: "Rest one\nRest two",
    });
  });

  it("normalises a lone \\r (not followed by \\n) to a line break too", () => {
    // A lone \r previously survived into the title untouched, which the
    // backend's title validation (no \r or \n) then rejected outright.
    expect(splitTitle("alpha\rbeta")).toEqual({ title: "alpha", detail: "beta" });
  });

  it("cuts a title at 200 code points, not UTF-16 units, so a multi-byte character straddling the boundary survives whole", () => {
    // "😀" is a surrogate pair (2 UTF-16 units, 1 code point) — a naive
    // `.slice(0, 200)` landing mid-pair would produce an unpaired surrogate.
    const body = `${"x".repeat(199)}😀y`; // 201 code points total
    const { title, detail } = splitTitle(body);
    expect(title).toBe(`${"x".repeat(199)}😀`);
    expect([...title]).toHaveLength(200);
    expect(detail).toBe(body);
  });
});

describe("draftWeeklyHighlights", () => {
  it("drafts one highlight per note, in day order", () => {
    const p = project(1, "Project A", [
      note(1, "2026-08-24", "Kickoff done"),
      note(2, "2026-08-25", "Scope review"),
    ]);

    const result = draftWeeklyHighlights(customer([p]), WEEK);

    expect(result).toEqual([
      { title: "Mon 24 Project A: Kickoff done", detail: null },
      { title: "Tue 25 Project A: Scope review", detail: null },
    ]);
  });

  it("two notes on the same day in the same project become two rows, in id order — never joined with \" / \"", () => {
    const p = project(1, "Project A", [
      note(1, "2026-08-24", "First"),
      note(2, "2026-08-24", "Second"),
    ]);

    const result = draftWeeklyHighlights(customer([p]), WEEK);

    expect(result).toEqual([
      { title: "Mon 24 Project A: First", detail: null },
      { title: "Mon 24 Project A: Second", detail: null },
    ]);
  });

  it("within a day, project notes (customer's project order) come before operations notes", () => {
    const projectA = project(1, "Project A", [note(1, "2026-08-24", "Kickoff done")]);
    const projectB = project(2, "Project B", [note(2, "2026-08-24", "Blocked on vendor")]);
    const ops = [opsNote(10, "2026-08-24", "Circuit flapping", "SD-WAN")];

    const result = draftWeeklyHighlights(customer([projectA, projectB], ops), WEEK);

    expect(result.map((h) => h.title)).toEqual([
      "Mon 24 Project A: Kickoff done",
      "Mon 24 Project B: Blocked on vendor",
      "Mon 24 [SD-WAN]: Circuit flapping",
    ]);
  });

  it("titles a project note with the project name and an operations note with its bracket", () => {
    const p = project(1, "Project A", [note(1, "2026-08-24", "Kickoff done")]);
    const ops = [opsNote(10, "2026-08-25", "Circuit flapping", "SD-WAN")];

    const result = draftWeeklyHighlights(customer([p], ops), WEEK);

    expect(result).toEqual([
      { title: "Mon 24 Project A: Kickoff done", detail: null },
      { title: "Tue 25 [SD-WAN]: Circuit flapping", detail: null },
    ]);
  });

  it("a multi-line body becomes a title from line one and the rest in detail", () => {
    const p = project(1, "Project A", [note(1, "2026-08-24", "Line one\nLine two\nLine three")]);

    const result = draftWeeklyHighlights(customer([p]), WEEK);

    expect(result).toEqual([{ title: "Mon 24 Project A: Line one", detail: "Line two\nLine three" }]);
  });

  it("cuts a title over 200 characters and puts the full body (never the prefix) in detail", () => {
    const longBody = "x".repeat(250);
    const p = project(1, "Project A", [note(1, "2026-08-24", longBody)]);

    const result = draftWeeklyHighlights(customer([p]), WEEK);

    expect(result).toHaveLength(1);
    expect(result[0].title.length).toBe(200);
    expect(result[0].title.startsWith("Mon 24 Project A: ")).toBe(true);
    expect(result[0].detail).toBe(longBody);
  });

  it("throughDay restricts drafted notes to that day and earlier, project and operations alike", () => {
    const p = project(1, "Project A", [
      note(1, "2026-08-24", "Mon note"),
      note(2, "2026-08-27", "Thu note"),
    ]);
    const ops = [opsNote(10, "2026-08-26", "Wed ops", "SD-WAN")];

    const result = draftWeeklyHighlights(customer([p], ops), WEEK, { throughDay: "2026-08-26" });

    expect(result.map((h) => h.title)).toEqual([
      "Mon 24 Project A: Mon note",
      "Wed 26 [SD-WAN]: Wed ops",
    ]);
  });

  it("a customer with no notes drafts to an empty array", () => {
    expect(draftWeeklyHighlights(customer([]), WEEK)).toEqual([]);
  });
});

describe("draftWeeklyAchievements", () => {
  it("drafts this week's saved highlights first, in order, with detail copied verbatim", () => {
    const wu = weeklyUpdateWithHighlights([
      savedHighlight(1, "Kickoff done", "Went well"),
      savedHighlight(2, "Scope review", null),
    ]);

    const result = draftWeeklyAchievements(customer([], [], wu), WEEK);

    expect(result).toEqual([
      { title: "Kickoff done", detail: "Went well" },
      { title: "Scope review", detail: null },
    ]);
  });

  it("appends Thursday-Sunday notes after the highlights, in day order, project notes before operations notes within a day", () => {
    const wu = weeklyUpdateWithHighlights([savedHighlight(1, "Kickoff done")]);
    const p = project(1, "Project A", [note(1, "2026-08-27", "Thu note")]);
    const ops = [opsNote(10, "2026-08-27", "Thu ops", "SD-WAN")];

    const result = draftWeeklyAchievements(customer([p], ops, wu), WEEK);

    expect(result).toEqual([
      { title: "Kickoff done", detail: null },
      { title: "Thu 27 Project A: Thu note", detail: null },
      { title: "Thu 27 [SD-WAN]: Thu ops", detail: null },
    ]);
  });

  it("skips Monday-Wednesday notes when highlights exist", () => {
    const wu = weeklyUpdateWithHighlights([savedHighlight(1, "Kickoff done")]);
    const p = project(1, "Project A", [
      note(1, "2026-08-24", "Mon note"),
      note(2, "2026-08-26", "Wed note"),
    ]);

    const result = draftWeeklyAchievements(customer([p], [], wu), WEEK);

    expect(result).toEqual([{ title: "Kickoff done", detail: null }]);
  });

  it("falls back to the whole week (Monday-Sunday) when there are no saved highlights", () => {
    const p = project(1, "Project A", [
      note(1, "2026-08-24", "Mon note"),
      note(2, "2026-08-30", "Sun note"),
    ]);

    const result = draftWeeklyAchievements(customer([p]), WEEK);

    expect(result).toEqual([
      { title: "Mon 24 Project A: Mon note", detail: null },
      { title: "Sun 30 Project A: Sun note", detail: null },
    ]);
  });

  it("an empty week (no highlights, no notes) drafts to an empty array", () => {
    expect(draftWeeklyAchievements(customer([]), WEEK)).toEqual([]);
  });

  it("a highlight-only week with no later notes drafts just the highlights", () => {
    const wu = weeklyUpdateWithHighlights([savedHighlight(1, "Kickoff done", "Detail here")]);

    const result = draftWeeklyAchievements(customer([], [], wu), WEEK);

    expect(result).toEqual([{ title: "Kickoff done", detail: "Detail here" }]);
  });

  it("a bare 'yyyy-MM-dd' noteDate (not an ISO instant) still groups and labels correctly in the no-highlights fallback", () => {
    const bareDateNote: DailyReviewNote = {
      id: 1,
      noteDate: "2026-08-24",
      body: "Kickoff done",
      author: AUTHOR,
      updatedAt: "2026-08-24T12:00:00.000Z",
    };
    const p = project(1, "Project A", [bareDateNote]);

    const result = draftWeeklyAchievements(customer([p]), WEEK);

    expect(result).toEqual([{ title: "Mon 24 Project A: Kickoff done", detail: null }]);
  });
});
