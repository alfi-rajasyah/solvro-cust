import { describe, expect, it } from "vitest";
import {
  buildEmbedUrl,
  buildGuestEmbedUrl,
  deriveEmbedPhases,
  embedOpenHref,
  embedScheduleLabel,
  embedSignInHref,
  embedTaskCounts,
  embedTaskScope,
  isGuestEmbed,
  nextMilestone,
  parseEmbedEpicId,
  parseEmbedLimit,
  sortEmbedTasks,
} from "./embedViews";
import { safeRedirectPath } from "./safeRedirect";
import type { Section, Task, TaskStatus } from "./queries";

const TODAY = "2026-10-09";

function task(over: Partial<Task> & { id: number }): Task {
  return {
    projectId: 1,
    title: `T${over.id}`,
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    startDate: null,
    dueDate: null,
    isMilestone: false,
    isCriticalPath: false,
    baselineStartDate: null,
    baselineDueDate: null,
    assignedToId: null,
    assignedTo: null,
    parentTaskId: null,
    sectionId: null,
    section: null,
    epicId: null,
    position: 0,
    labels: [],
    _count: { subtasks: 0, comments: 0 },
    itopTicketRef: null,
    ...over,
  };
}

const iso = (day: string) => `${day}T00:00:00.000Z`;

describe("parseEmbedLimit", () => {
  it("defaults to 10", () => {
    expect(parseEmbedLimit(null)).toBe(10);
    expect(parseEmbedLimit("")).toBe(10);
    expect(parseEmbedLimit("abc")).toBe(10);
    expect(parseEmbedLimit("0")).toBe(10);
    expect(parseEmbedLimit("-3")).toBe(10);
    expect(parseEmbedLimit("2.5")).toBe(10);
  });
  it("accepts a positive whole number and caps it", () => {
    expect(parseEmbedLimit("4")).toBe(4);
    expect(parseEmbedLimit("500")).toBe(50);
  });
});

describe("parseEmbedEpicId", () => {
  it("reads a positive id, else null", () => {
    expect(parseEmbedEpicId("12")).toBe(12);
    expect(parseEmbedEpicId(null)).toBeNull();
    expect(parseEmbedEpicId("0")).toBeNull();
    expect(parseEmbedEpicId("x")).toBeNull();
    expect(parseEmbedEpicId("1e3")).toBeNull();
  });
});

describe("embedTaskScope / embedTaskCounts", () => {
  const tasks = [
    task({ id: 1, epicId: 5, status: "DONE" }),
    task({ id: 2, epicId: 5 }),
    task({ id: 3, epicId: null }),
    task({ id: 4, parentTaskId: 1 }),
  ];
  it("drops subtasks", () => {
    expect(embedTaskScope(tasks, null).map((t) => t.id)).toEqual([1, 2, 3]);
  });
  it("narrows to an epic", () => {
    expect(embedTaskScope(tasks, 5).map((t) => t.id)).toEqual([1, 2]);
    expect(embedTaskScope(tasks, 99)).toEqual([]);
  });
  it("counts done of total", () => {
    expect(embedTaskCounts(embedTaskScope(tasks, 5))).toEqual({ done: 1, total: 2 });
  });
});

describe("sortEmbedTasks", () => {
  const mk = (id: number, status: TaskStatus, day: string | null) =>
    task({ id, status, dueDate: day ? iso(day) : null });

  it("orders overdue, then open by due date, then undated, then done", () => {
    const sorted = sortEmbedTasks(
      [
        mk(1, "DONE", "2026-10-01"),
        mk(2, "TODO", null),
        mk(3, "TODO", "2026-10-20"),
        mk(4, "IN_PROGRESS", "2026-10-10"),
        mk(5, "TODO", "2026-10-02"),
        mk(6, "TODO", "2026-09-20"),
      ],
      TODAY,
    );
    expect(sorted.map((t) => t.id)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("treats a task due today as not overdue", () => {
    const sorted = sortEmbedTasks([mk(1, "TODO", TODAY), mk(2, "TODO", "2026-10-08")], TODAY);
    expect(sorted.map((t) => t.id)).toEqual([2, 1]);
  });

  it("is stable on ties and does not mutate its input", () => {
    const input = [mk(9, "TODO", "2026-10-12"), mk(3, "TODO", "2026-10-12")];
    expect(sortEmbedTasks(input, TODAY).map((t) => t.id)).toEqual([3, 9]);
    expect(input.map((t) => t.id)).toEqual([9, 3]);
  });
});

describe("deriveEmbedPhases", () => {
  const section = (id: number, name: string, position: number): Section => ({
    id,
    projectId: 1,
    name,
    position,
    color: "#000000",
    createdAt: iso("2026-01-01"),
  });

  it("derives dates and status per section, in section order", () => {
    const phases = deriveEmbedPhases(
      [section(2, "Build", 1), section(1, "Discovery", 0), section(3, "Empty", 2)],
      [
        task({ id: 1, sectionId: 1, status: "DONE", startDate: iso("2026-09-01"), dueDate: iso("2026-09-10") }),
        task({ id: 2, sectionId: 2, status: "IN_PROGRESS", startDate: iso("2026-09-12"), dueDate: iso("2026-10-30") }),
        task({ id: 3, sectionId: 2, status: "TODO", dueDate: iso("2026-11-15") }),
        task({ id: 4, sectionId: null, status: "TODO", dueDate: iso("2030-01-01") }),
      ],
    );
    expect(phases).toEqual([
      { name: "Discovery", startDate: "2026-09-01", endDate: "2026-09-10", status: "done" },
      { name: "Build", startDate: "2026-09-12", endDate: "2026-11-15", status: "in_progress" },
      { name: "Empty", startDate: null, endDate: null, status: "not_started" },
    ]);
  });

  it("is not started when every task is to do", () => {
    const [p] = deriveEmbedPhases(
      [section(1, "A", 0)],
      [task({ id: 1, sectionId: 1, status: "TODO", dueDate: iso("2026-09-10") })],
    );
    expect(p.status).toBe("not_started");
    expect(p.startDate).toBe("2026-09-10");
  });
});

describe("nextMilestone", () => {
  const ms = (id: number, status: TaskStatus, day: string | null) =>
    task({ id, isMilestone: true, status, dueDate: day ? iso(day) : null });

  it("picks the earliest open milestone from today on", () => {
    expect(
      nextMilestone([ms(1, "TODO", "2026-12-01"), ms(2, "TODO", "2026-10-20"), ms(3, "DONE", "2026-10-10")], TODAY)?.id,
    ).toBe(2);
  });
  it("falls back to an overdue open milestone, ignores non-milestones and undated ones", () => {
    expect(nextMilestone([ms(1, "TODO", "2026-09-01"), ms(2, "TODO", null)], TODAY)?.id).toBe(1);
    expect(nextMilestone([task({ id: 1, dueDate: iso("2026-10-20") })], TODAY)).toBeNull();
    expect(nextMilestone([], TODAY)).toBeNull();
  });
});

describe("links", () => {
  it("builds a sign-in link that round-trips through safeRedirectPath", () => {
    const path = "/embed/projects/7/tasks?epic=3&limit=5";
    const href = embedSignInHref(path);
    expect(href).toBe("/login?from=%2Fembed%2Fprojects%2F7%2Ftasks%3Fepic%3D3%26limit%3D5");
    const from = new URLSearchParams(href.split("?")[1]).get("from");
    expect(safeRedirectPath(from)).toBe(path);
  });
  it("opens the project, or a task on its list tab", () => {
    expect(embedOpenHref(7)).toBe("/projects/7");
    expect(embedOpenHref(7, 42)).toBe("/projects/7/list?task=42");
  });
});

describe("embedScheduleLabel", () => {
  it("matches the header facts wording", () => {
    expect(embedScheduleLabel(null)).toBe("No baseline");
    expect(embedScheduleLabel(undefined)).toBe("No baseline");
    expect(embedScheduleLabel(3)).toBe("3d behind");
    expect(embedScheduleLabel(-2)).toBe("2d ahead");
    expect(embedScheduleLabel(0)).toBe("On schedule");
  });
});

describe("isGuestEmbed", () => {
  it("is on only for embed=1", () => {
    expect(isGuestEmbed("1")).toBe(true);
    for (const v of [null, undefined, "", "0", "true", "11", " 1"]) expect(isGuestEmbed(v)).toBe(false);
  });
});

describe("buildEmbedUrl / buildGuestEmbedUrl", () => {
  const origin = "https://solvro.acme.com";
  it("builds the three signed-in views", () => {
    expect(buildEmbedUrl(origin, 7, "tasks")).toBe("https://solvro.acme.com/embed/projects/7/tasks");
    expect(buildEmbedUrl(origin, 7, "status")).toBe("https://solvro.acme.com/embed/projects/7/status");
    expect(buildEmbedUrl(origin + "/", 7, "timeline")).toBe("https://solvro.acme.com/embed/projects/7/timeline");
  });
  it("adds the epic filter to the task table only", () => {
    expect(buildEmbedUrl(origin, 7, "tasks", 3)).toBe("https://solvro.acme.com/embed/projects/7/tasks?epic=3");
    expect(buildEmbedUrl(origin, 7, "status", 3)).toBe("https://solvro.acme.com/embed/projects/7/status");
    expect(buildEmbedUrl(origin, 7, "tasks", null)).toBe("https://solvro.acme.com/embed/projects/7/tasks");
  });
  it("parses back to what the embed routes read", () => {
    const url = new URL(buildEmbedUrl(origin, 7, "tasks", 3));
    expect(parseEmbedEpicId(url.searchParams.get("epic"))).toBe(3);
  });
  it("appends embed=1 to a guest link", () => {
    expect(buildGuestEmbedUrl("https://solvro.acme.com/share/abc")).toBe("https://solvro.acme.com/share/abc?embed=1");
    expect(buildGuestEmbedUrl("https://x/share/abc?a=b")).toBe("https://x/share/abc?a=b&embed=1");
    expect(isGuestEmbed(new URL(buildGuestEmbedUrl("https://x/share/abc")).searchParams.get("embed"))).toBe(true);
  });
});
