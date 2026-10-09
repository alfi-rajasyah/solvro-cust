import { describe, expect, it } from "vitest";
import { describeNotification, notificationHref } from "./notificationText";
import type { ActivityEvent, AppNotification } from "./queries";

function event(over: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 1,
    entityType: "task",
    entityId: 42,
    action: "updated",
    entityLabel: "Configure backup jobs",
    changes: { assignee: { from: null, to: { id: 3, username: "ana" } } },
    createdAt: "2026-09-30T10:00:00.000Z",
    actor: { id: 9, username: "rina.wijaya", avatarUrl: null },
    ...over,
  };
}

function notif(over: Partial<AppNotification> = {}, ev: Partial<ActivityEvent> = {}): AppNotification {
  return {
    id: 5,
    reason: "assigned",
    readAt: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    event: event(ev),
    projectId: 7,
    projectName: "Acme rollout",
    ...over,
  };
}

describe("describeNotification", () => {
  it("assigned", () => {
    expect(describeNotification(notif()).text).toBe("rina.wijaya assigned you Configure backup jobs");
  });

  it("commented", () => {
    const n = notif(
      { reason: "commented" },
      { entityType: "comment", entityId: 900, action: "created", changes: { taskId: 42 } },
    );
    expect(describeNotification(n).text).toBe("rina.wijaya commented on Configure backup jobs");
  });

  it("mentioned", () => {
    expect(describeNotification(notif({ reason: "mentioned" })).text).toBe(
      "rina.wijaya mentioned you on Configure backup jobs",
    );
  });

  it("emphasises actor and task in parts", () => {
    const { parts } = describeNotification(notif());
    expect(parts[0]).toEqual({ kind: "actor", text: "rina.wijaya" });
    expect(parts[parts.length - 1]).toEqual({ kind: "entity", text: "Configure backup jobs" });
  });

  it("a deleted actor reads Someone", () => {
    expect(describeNotification(notif({}, { actor: null })).text).toBe("Someone assigned you Configure backup jobs");
  });

  it("falls back to the activity sentence for an unknown reason or a missing title", () => {
    expect(describeNotification(notif({ reason: "weird" as never })).text).toMatch(/^rina\.wijaya /);
    expect(describeNotification(notif({}, { entityLabel: null })).text).toMatch(/^rina\.wijaya /);
  });
});

describe("notificationHref", () => {
  it("task events link to the task via entityId", () => {
    expect(notificationHref(notif())).toBe("/projects/7?task=42");
  });

  it("comment events link via changes.taskId, not the comment id", () => {
    const n = notif({ reason: "commented" }, { entityType: "comment", entityId: 900, action: "created", changes: { taskId: 42 } });
    expect(notificationHref(n)).toBe("/projects/7?task=42");
  });

  it("falls back to the project when no task is known or it was deleted", () => {
    expect(notificationHref(notif({}, { entityType: "comment", entityId: 900, changes: null }))).toBe("/projects/7");
    expect(notificationHref(notif({}, { action: "deleted" }))).toBe("/projects/7");
    expect(notificationHref(notif({}, { entityType: "risk" }))).toBe("/projects/7");
  });
});

describe("project seat notifications", () => {
  const seatNotif = (changes: Record<string, unknown>, action: "created" | "updated" = "created") =>
    notif({}, { entityType: "project", entityId: 7, action, entityLabel: "Acme rollout", changes });

  it("made you TAM of the project (created and changed)", () => {
    expect(describeNotification(seatNotif({ tam: { id: 3, username: "ana" } })).text).toBe(
      "rina.wijaya made you TAM of Acme rollout",
    );
    expect(
      describeNotification(
        seatNotif({ tam: { from: { id: 2, username: "budi" }, to: { id: 3, username: "ana" } } }, "updated"),
      ).text,
    ).toBe("rina.wijaya made you TAM of Acme rollout");
  });

  it("emphasises the project name and links to the project", () => {
    const n = seatNotif({ tam: { id: 3, username: "ana" } });
    const { parts } = describeNotification(n);
    expect(parts[parts.length - 1]).toEqual({ kind: "entity", text: "Acme rollout" });
    expect(notificationHref(n)).toBe("/projects/7");
  });

  it("uses the event label when the project name is missing", () => {
    const n = seatNotif({ tam: { id: 3, username: "ana" } });
    n.projectName = "";
    expect(describeNotification(n).text).toBe("rina.wijaya made you TAM of Acme rollout");
  });
});
