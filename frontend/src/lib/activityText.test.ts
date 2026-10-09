import { describe, expect, it } from "vitest";
import { describeActivity } from "./activityText";
import type { ActivityEvent } from "./queries";

function ev(over: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 1,
    entityType: "task",
    entityId: 42,
    action: "created",
    entityLabel: "Configure backup jobs",
    changes: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    actor: { id: 3, username: "maya.putri", avatarUrl: null },
    ...over,
  };
}

const text = (e: ActivityEvent) => describeActivity(e).text;

describe("describeActivity - tasks", () => {
  it("created with an assignee", () => {
    const e = ev({ changes: { assignee: { from: null, to: { id: 5, username: "ben" } } } });
    expect(text(e)).toBe("maya.putri created the task Configure backup jobs, assigned to ben");
  });

  it("created / deleted", () => {
    expect(text(ev())).toBe("maya.putri created the task Configure backup jobs");
    expect(text(ev({ action: "deleted" }))).toBe("maya.putri deleted the task Configure backup jobs");
  });

  it("links to the task unless it was deleted", () => {
    expect(describeActivity(ev()).taskId).toBe(42);
    expect(describeActivity(ev({ action: "updated", changes: { status: { from: "TODO", to: "DONE" } } })).taskId).toBe(42);
    expect(describeActivity(ev({ action: "deleted" })).taskId).toBeNull();
    expect(describeActivity(ev({ entityType: "risk" })).taskId).toBeNull();
  });

  it("due date change uses the day formatter", () => {
    const e = ev({
      action: "updated",
      changes: { dueDate: { from: "2026-10-02", to: "2026-10-05" } },
    });
    const y = new Date().getFullYear();
    const expected = (d: string) => (y === 2026 ? d : `${d} 2026`);
    expect(text(e)).toBe(
      `maya.putri changed the due date of Configure backup jobs from ${expected("2 Oct")} to ${expected("5 Oct")}`,
    );
  });

  it("setting and clearing a date", () => {
    const set = ev({ action: "updated", changes: { startDate: { from: null, to: "2026-10-05" } } });
    expect(text(set)).toMatch(/^maya\.putri set the start date of Configure backup jobs to 5 Oct/);
    const clear = ev({ action: "updated", changes: { dueDate: { from: "2026-10-02", to: null } } });
    expect(text(clear)).toMatch(/^maya\.putri cleared the due date of Configure backup jobs \(was 2 Oct/);
  });

  it("status and priority use the shared labels", () => {
    expect(text(ev({ action: "updated", changes: { status: { from: "TODO", to: "IN_PROGRESS" } } }))).toBe(
      "maya.putri changed the status of Configure backup jobs from To do to In progress",
    );
    expect(text(ev({ action: "updated", changes: { priority: { from: "LOW", to: "URGENT" } } }))).toBe(
      "maya.putri changed the priority of Configure backup jobs from Low to Urgent",
    );
  });

  it("title rename, assignee, flags", () => {
    expect(text(ev({ action: "updated", changes: { title: { from: "Old", to: "New name" } } }))).toBe(
      "maya.putri renamed the task Configure backup jobs to New name",
    );
    expect(
      text(ev({ action: "updated", changes: { assignee: { from: null, to: { id: 5, username: "ben" } } } })),
    ).toBe("maya.putri assigned Configure backup jobs to ben");
    expect(
      text(
        ev({
          action: "updated",
          changes: { assignee: { from: { id: 5, username: "ben" }, to: { id: 6, username: "cara" } } },
        }),
      ),
    ).toBe("maya.putri reassigned Configure backup jobs from ben to cara");
    expect(
      text(ev({ action: "updated", changes: { assignee: { from: { id: 5, username: "ben" }, to: null } } })),
    ).toBe("maya.putri unassigned Configure backup jobs (was ben)");
    expect(text(ev({ action: "updated", changes: { isMilestone: { from: false, to: true } } }))).toBe(
      "maya.putri marked Configure backup jobs as a milestone",
    );
    expect(text(ev({ action: "updated", changes: { isCriticalPath: { from: true, to: false } } }))).toBe(
      "maya.putri removed Configure backup jobs from the critical path",
    );
  });

  it("description changes never show text", () => {
    const e = ev({
      action: "updated",
      changes: { description: { changed: true, from: "SECRET OLD", to: "SECRET NEW" } },
    });
    expect(text(e)).toBe("maya.putri updated the description of Configure backup jobs");
    expect(text(e)).not.toMatch(/SECRET/);
  });

  it("labels added and removed", () => {
    const e = ev({
      action: "updated",
      changes: { labels: { added: ["backend", "urgent"], removed: ["later"] } },
    });
    expect(text(e)).toBe(
      "maya.putri changed the labels on Configure backup jobs (added backend, urgent; removed later)",
    );
  });

  it("foreign-key ids read without values", () => {
    expect(text(ev({ action: "updated", changes: { sectionId: { from: 1, to: 2 } } }))).toBe(
      "maya.putri changed the section of Configure backup jobs",
    );
    expect(text(ev({ action: "updated", changes: { epicId: { from: null, to: 9 } } }))).toBe(
      "maya.putri changed the epic of Configure backup jobs",
    );
    expect(text(ev({ action: "updated", changes: { parentTaskId: { from: null, to: 9 } } }))).toBe(
      "maya.putri changed the parent task of Configure backup jobs",
    );
  });

  it("names the iTop ticket link properly", () => {
    expect(text(ev({ action: "updated", changes: { itopTicketRef: { from: null, to: "R-000123" } } }))).toBe(
      "maya.putri changed the iTop ticket of Configure backup jobs from none to R-000123",
    );
  });

  it("several fields collapse into one clause list, many fields into a count", () => {
    const some = ev({
      action: "updated",
      changes: { status: { from: "TODO", to: "DONE" }, priority: { from: "LOW", to: "HIGH" } },
    });
    expect(text(some)).toBe(
      "maya.putri updated Configure backup jobs: status from To do to Done, priority from Low to High",
    );
    const many = ev({
      action: "updated",
      changes: {
        status: { from: "TODO", to: "DONE" },
        priority: { from: "LOW", to: "HIGH" },
        title: { from: "a", to: "b" },
        dueDate: { from: null, to: "2026-10-05" },
      },
    });
    expect(text(many)).toBe("maya.putri updated 4 fields of Configure backup jobs");
  });

  it("empty changes on an update", () => {
    expect(text(ev({ action: "updated", changes: {} }))).toBe("maya.putri updated Configure backup jobs");
  });

  it("emphasises the actor and the entity in parts", () => {
    const { parts } = describeActivity(ev());
    expect(parts[0]).toEqual({ kind: "actor", text: "maya.putri" });
    expect(parts.find((p) => p.kind === "entity")?.text).toBe("Configure backup jobs");
  });
});

describe("describeActivity - comments", () => {
  it("names the task, never the body", () => {
    const e = ev({ entityType: "comment", entityId: 900, action: "created", changes: { body: "TOP SECRET" } });
    expect(text(e)).toBe("maya.putri commented on Configure backup jobs");
    expect(text(e)).not.toMatch(/SECRET/);
    expect(describeActivity(e).taskId).toBeNull();
  });

  it("links to the task when the event carries its id", () => {
    const e = ev({ entityType: "comment", entityId: 900, action: "created", changes: { taskId: 42 } });
    expect(describeActivity(e).taskId).toBe(42);
  });

  it("edited / deleted / no label", () => {
    expect(text(ev({ entityType: "comment", action: "updated" }))).toBe(
      "maya.putri edited a comment on Configure backup jobs",
    );
    expect(text(ev({ entityType: "comment", action: "deleted" }))).toBe(
      "maya.putri deleted a comment on Configure backup jobs",
    );
    expect(text(ev({ entityType: "comment", action: "created", entityLabel: null }))).toBe(
      "maya.putri commented on a task",
    );
  });
});

describe("describeActivity - risks", () => {
  it("created / deleted", () => {
    expect(text(ev({ entityType: "risk", entityLabel: "Vendor delay" }))).toBe(
      "maya.putri added the risk Vendor delay",
    );
    expect(text(ev({ entityType: "risk", entityLabel: "Vendor delay", action: "deleted" }))).toBe(
      "maya.putri deleted the risk Vendor delay",
    );
  });

  it("status change uses risk labels", () => {
    const e = ev({
      entityType: "risk",
      entityLabel: "Vendor delay",
      action: "updated",
      changes: { status: { from: "OPEN", to: "MITIGATED" } },
    });
    expect(text(e)).toBe("maya.putri changed the status of the risk Vendor delay from Open to Mitigated");
  });

  it("long-text plan changes read as an update, never text", () => {
    const e = ev({
      entityType: "risk",
      entityLabel: "Vendor delay",
      action: "updated",
      changes: { mitigationPlan: { changed: true } },
    });
    expect(text(e)).toBe("maya.putri updated the mitigation plan of the risk Vendor delay");
  });

  it("does not link to a task", () => {
    expect(describeActivity(ev({ entityType: "risk" })).taskId).toBeNull();
  });
});

describe("describeActivity - notes", () => {
  it("states visibility and never a body", () => {
    const internal = ev({
      entityType: "note",
      entityLabel: null,
      action: "created",
      changes: { visibility: "INTERNAL", body: "PRIVATE TEXT" },
    });
    expect(text(internal)).toBe("maya.putri added an internal note");
    expect(text(internal)).not.toMatch(/PRIVATE/);
    expect(
      text(ev({ entityType: "note", entityLabel: null, action: "created", changes: { visibility: "CUSTOMER_FACING" } })),
    ).toBe("maya.putri added a customer-facing note");
  });

  it("updated / deleted / unknown visibility", () => {
    expect(
      text(ev({ entityType: "note", entityLabel: null, action: "updated", changes: { visibility: "INTERNAL" } })),
    ).toBe("maya.putri edited an internal note");
    expect(
      text(
        ev({
          entityType: "note",
          entityLabel: null,
          action: "updated",
          changes: { visibility: { from: "INTERNAL", to: "CUSTOMER_FACING" } },
        }),
      ),
    ).toBe("maya.putri changed a note from internal to customer-facing");
    expect(text(ev({ entityType: "note", entityLabel: null, action: "deleted", changes: { visibility: "INTERNAL" } }))).toBe(
      "maya.putri deleted an internal note",
    );
    expect(text(ev({ entityType: "note", entityLabel: null, action: "created", changes: null }))).toBe(
      "maya.putri added a note",
    );
  });
});

describe("describeActivity - members", () => {
  it("added and removed", () => {
    expect(text(ev({ entityType: "member", entityLabel: "ben", action: "added" }))).toBe(
      "maya.putri added ben to the project",
    );
    expect(text(ev({ entityType: "member", entityLabel: "ben", action: "removed" }))).toBe(
      "maya.putri removed ben from the project",
    );
    expect(
      text(ev({ entityType: "member", entityLabel: "ben", action: "removed", changes: { unassignedTasks: 2 } })),
    ).toBe("maya.putri removed ben from the project (unassigned 2 tasks)");
    expect(text(ev({ entityType: "member", entityLabel: null, action: "added" }))).toBe(
      "maya.putri added a member to the project",
    );
  });
});

describe("describeActivity - project", () => {
  const project = (changes: Record<string, unknown>) =>
    ev({ entityType: "project", entityLabel: "Acme rollout", action: "updated", changes });

  it("rename, status, customer", () => {
    expect(text(project({ name: { from: "Acme", to: "Acme rollout" } }))).toBe(
      "maya.putri renamed the project from Acme to Acme rollout",
    );
    expect(text(project({ status: { from: "ACTIVE", to: "ON_HOLD" } }))).toBe(
      "maya.putri changed the project status from Active to On hold",
    );
    expect(text(project({ customer: { from: { id: 1, name: "Foo" }, to: { id: 2, name: "Bar" } } }))).toBe(
      "maya.putri changed the project customer from Foo to Bar",
    );
    expect(text(project({ customerId: { from: 1, to: 2 } }))).toBe("maya.putri changed the project customer");
    expect(text(project({ customerId: { from: null, to: 2 } }))).toBe("maya.putri changed the project customer");
  });

  it("several fields", () => {
    expect(text(project({ name: { from: "A", to: "B" }, status: { from: "ACTIVE", to: "COMPLETED" } }))).toBe(
      "maya.putri updated the project: name from A to B, status from Active to Completed",
    );
  });
});

describe("describeActivity - degrades gracefully", () => {
  it("null actor reads Someone", () => {
    expect(text(ev({ actor: null }))).toBe("Someone created the task Configure backup jobs");
  });

  it("unknown entity type / action", () => {
    const e = ev({ entityType: "widget" as never, action: "exploded" as never });
    expect(text(e)).toBe("maya.putri exploded the widget Configure backup jobs");
  });

  it("garbage changes never throw", () => {
    const weird: unknown[] = ["str", 5, [], [1, 2], { a: 1 }, { status: 3 }, { status: { from: {}, to: [] } }, { labels: 7 }];
    for (const changes of weird) {
      for (const entityType of ["task", "risk", "project", "note", "member", "comment", "nope"]) {
        for (const action of ["created", "updated", "deleted", "added", "removed", "nope"]) {
          const out = describeActivity(ev({ entityType, action, changes } as never));
          expect(out.text.startsWith("maya.putri")).toBe(true);
        }
      }
    }
  });

  it("null label with an update still reads", () => {
    expect(text(ev({ entityLabel: null, action: "updated", changes: { status: { from: "TODO", to: "DONE" } } }))).toBe(
      "maya.putri changed the status of a task from To do to Done",
    );
  });

  it("clips very long values", () => {
    const long = "x".repeat(200);
    const out = text(ev({ action: "updated", changes: { title: { from: "a", to: long } } }));
    expect(out.length).toBeLessThan(120);
  });
});

describe("describeActivity - guest links", () => {
  const link = (over: Partial<ActivityEvent> = {}) =>
    ev({ entityType: "share_link", entityLabel: "For Nusantara IT", ...over });

  it("created / revoked name the label", () => {
    expect(text(link({ action: "created" }))).toBe("maya.putri created the guest link For Nusantara IT");
    expect(text(link({ action: "removed" }))).toBe("maya.putri revoked the guest link For Nusantara IT");
  });

  it("unlabelled links read as a guest link", () => {
    expect(text(link({ action: "created", entityLabel: null }))).toBe("maya.putri created a guest link");
    expect(text(link({ action: "removed", entityLabel: null }))).toBe("maya.putri revoked a guest link");
  });

  it("emphasises the label and never links to a task", () => {
    const s = describeActivity(link({ action: "created" }));
    expect(s.parts.filter((p) => p.kind === "entity").map((p) => p.text)).toEqual(["For Nusantara IT"]);
    expect(s.taskId).toBeNull();
  });
});

describe("describeActivity - project TAM", () => {
  it("a TAM change reads as from/to usernames", () => {
    const project = (changes: Record<string, unknown>) =>
      ev({ entityType: "project", entityLabel: "Acme rollout", action: "updated", changes });
    expect(text(project({ tam: { from: { id: 1, username: "ana" }, to: { id: 2, username: "budi" } } }))).toBe(
      "maya.putri changed the project TAM from ana to budi",
    );
  });

  it("project created with its TAM and customer still reads as a plain creation", () => {
    const created = ev({
      entityType: "project",
      entityLabel: "Acme rollout",
      changes: { tam: { id: 1, username: "ana" }, customer: { id: 4, name: "Acme" } },
    });
    expect(text(created)).toBe("maya.putri created the project Acme rollout");
  });
});

describe("describeActivity - epics", () => {
  it("created, updated, deleted", () => {
    const epic = (over: Partial<ActivityEvent>) =>
      ev({ entityType: "epic", entityLabel: "Billing", ...over });
    expect(text(epic({}))).toBe("maya.putri created the epic Billing");
    expect(text(epic({ action: "deleted" }))).toBe("maya.putri deleted the epic Billing");
    expect(text(epic({ action: "updated", changes: { status: { from: "TODO", to: "DONE" } } }))).toBe(
      "maya.putri changed the status of Billing from To do to Done",
    );
    expect(describeActivity(epic({})).taskId).toBeNull();
    expect(text(epic({ action: "deleted", changes: { taskCount: 3 } }))).toBe(
      "maya.putri deleted the epic Billing (3 tasks)",
    );
    expect(text(epic({ action: "updated", changes: { owner: { from: null, to: { id: 2, username: "budi" } } } }))).toBe(
      "maya.putri changed the owner of Billing from none to budi",
    );
    expect(text(epic({ action: "updated", changes: { color: { from: "#111111", to: "#222222" } } }))).toBe(
      "maya.putri changed the color of Billing from #111111 to #222222",
    );
    expect(text(epic({ action: "updated", changes: { description: { changed: true } } }))).toBe(
      "maya.putri updated the description of Billing",
    );
  });
});
