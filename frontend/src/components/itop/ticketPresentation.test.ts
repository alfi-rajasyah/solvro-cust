import { describe, expect, it } from "vitest";
import { ageLabel, itopTicketUrl, slaLabel, statusLabel, statusTone } from "./ticketPresentation";

describe("statusLabel", () => {
  it("humanizes known iTop statuses", () => {
    expect(statusLabel("escalated_ttr")).toBe("Escalated TTR");
    expect(statusLabel("waiting_for_approval")).toBe("Waiting for approval");
  });

  it("falls back to the raw value for an unknown status", () => {
    expect(statusLabel("some_future_status")).toBe("some_future_status");
  });
});

describe("statusTone", () => {
  it("is danger (rose) for an escalated status", () => {
    expect(statusTone({ status: "escalated_ttr", slaTtrPassed: false })).toBe("rose");
    expect(statusTone({ status: "escalated_tto", slaTtrPassed: false })).toBe("rose");
  });

  it("is danger (rose) whenever slaTtrPassed is true, regardless of status", () => {
    expect(statusTone({ status: "assigned", slaTtrPassed: true })).toBe("rose");
  });

  it("is warning (amber) for pending/waiting statuses", () => {
    expect(statusTone({ status: "pending", slaTtrPassed: false })).toBe("amber");
    expect(statusTone({ status: "waiting_for_approval", slaTtrPassed: false })).toBe("amber");
  });

  it("is muted (gray) for resolved/closed statuses", () => {
    expect(statusTone({ status: "resolved", slaTtrPassed: false })).toBe("gray");
    expect(statusTone({ status: "closed", slaTtrPassed: false })).toBe("gray");
  });

  it("falls back to gray for an unknown status", () => {
    expect(statusTone({ status: "some_future_status", slaTtrPassed: false })).toBe("gray");
  });
});

describe("ageLabel", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");

  it("renders minutes under an hour", () => {
    expect(ageLabel("2026-09-22T11:20:00.000Z", now)).toBe("40 min");
  });

  it("renders whole hours under a day", () => {
    expect(ageLabel("2026-09-22T07:00:00.000Z", now)).toBe("5 h");
  });

  it("renders whole days at or beyond 24 hours", () => {
    expect(ageLabel("2026-09-20T12:00:00.000Z", now)).toBe("2 d");
  });

  it("never goes negative for a startDate at/after now", () => {
    expect(ageLabel("2026-09-22T12:05:00.000Z", now)).toBe("0 min");
  });

  it("renders — for a null or unparseable startDate, never a garbage duration", () => {
    expect(ageLabel(null, now)).toBe("—");
    expect(ageLabel("not-a-date", now)).toBe("—");
  });
});

describe("slaLabel", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");

  it("reports a breached TTR first, ahead of a breached TTO", () => {
    expect(
      slaLabel(
        { status: "escalated_ttr", slaTtoPassed: true, slaTtrPassed: true, ttr: null },
        now,
      ),
    ).toBe("TTR breached");
  });

  it("reports a breached TTO when only that clock has passed", () => {
    expect(
      slaLabel({ status: "assigned", slaTtoPassed: true, slaTtrPassed: false, ttr: null }, now),
    ).toBe("TTO breached");
  });

  it("reports Paused for a pending ticket with neither SLA breached", () => {
    expect(
      slaLabel(
        { status: "pending", slaTtoPassed: false, slaTtrPassed: false, ttr: "2026-09-23T12:00:00.000Z" },
        now,
      ),
    ).toBe("Paused");
  });

  it("reports the time left until ttr when it's in the future", () => {
    expect(
      slaLabel(
        {
          status: "assigned",
          slaTtoPassed: false,
          slaTtrPassed: false,
          ttr: "2026-09-22T15:00:00.000Z",
        },
        now,
      ),
    ).toBe("TTR 3 h left");
  });

  it("combines hours and minutes when both are non-zero", () => {
    expect(
      slaLabel(
        {
          status: "new",
          slaTtoPassed: false,
          slaTtrPassed: false,
          ttr: "2026-09-22T13:20:00.000Z",
        },
        now,
      ),
    ).toBe("TTR 1 h 20 min left");
  });

  it("renders — when ttr is null", () => {
    expect(
      slaLabel({ status: "new", slaTtoPassed: false, slaTtrPassed: false, ttr: null }, now),
    ).toBe("—");
  });

  it("renders — when ttr has already elapsed but the SLA flags haven't caught up", () => {
    expect(
      slaLabel(
        {
          status: "assigned",
          slaTtoPassed: false,
          slaTtrPassed: false,
          ttr: "2026-09-22T11:00:00.000Z",
        },
        now,
      ),
    ).toBe("—");
  });
});

describe("itopTicketUrl", () => {
  it("builds the details deep link", () => {
    expect(itopTicketUrl("https://itop.example.test", { id: 42, class: "Incident" })).toBe(
      "https://itop.example.test/pages/UI.php?operation=details&class=Incident&id=42",
    );
  });

  it("strips a trailing slash on baseUrl so the path never doubles up", () => {
    expect(itopTicketUrl("https://itop.example.test/", { id: 7, class: "UserRequest" })).toBe(
      "https://itop.example.test/pages/UI.php?operation=details&class=UserRequest&id=7",
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(itopTicketUrl("https://itop.example.test//", { id: 7, class: "UserRequest" })).toBe(
      "https://itop.example.test/pages/UI.php?operation=details&class=UserRequest&id=7",
    );
  });
});
