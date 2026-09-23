import { describe, expect, it } from "vitest";
import { formatElapsed, readStoredTimer } from "./useTicketTimer";

describe("formatElapsed", () => {
  it("pads single-digit units to two digits", () => {
    expect(formatElapsed(5)).toBe("00:00:05");
  });

  it("formats a mixed hours/minutes/seconds duration", () => {
    // 1h 12m 34s
    expect(formatElapsed(3600 + 12 * 60 + 34)).toBe("01:12:34");
  });

  it("floors fractional seconds", () => {
    expect(formatElapsed(59.9)).toBe("00:00:59");
  });

  it("grows hours past two digits rather than wrapping", () => {
    expect(formatElapsed(100 * 3600)).toBe("100:00:00");
  });

  it("clamps negative input to zero", () => {
    expect(formatElapsed(-42)).toBe("00:00:00");
  });

  it("clamps non-finite input to zero", () => {
    expect(formatElapsed(NaN)).toBe("00:00:00");
    expect(formatElapsed(Infinity)).toBe("00:00:00");
  });
});

describe("readStoredTimer", () => {
  const USER_ID = 7;
  const valid = {
    userId: USER_ID,
    ticketId: 4512,
    customerId: 42,
    ref: "R-004512",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  };

  it("accepts a well-formed stored timer for the expected user", () => {
    expect(readStoredTimer(JSON.stringify(valid), USER_ID)).toEqual(valid);
  });

  it("is null when the stored userId doesn't match the expected user", () => {
    expect(readStoredTimer(JSON.stringify(valid), USER_ID + 1)).toBeNull();
  });

  it("is null when userId is missing or not a number", () => {
    expect(readStoredTimer(JSON.stringify({ ...valid, userId: "7" }), USER_ID)).toBeNull();
    const { userId: _userId, ...rest } = valid;
    expect(readStoredTimer(JSON.stringify(rest), USER_ID)).toBeNull();
  });

  it("is null for a missing value", () => {
    expect(readStoredTimer(null, USER_ID)).toBeNull();
    expect(readStoredTimer("", USER_ID)).toBeNull();
  });

  it("is null for unparsable JSON", () => {
    expect(readStoredTimer("{not json", USER_ID)).toBeNull();
  });

  it("is null for a JSON value that isn't an object", () => {
    expect(readStoredTimer("42", USER_ID)).toBeNull();
    expect(readStoredTimer("null", USER_ID)).toBeNull();
    expect(readStoredTimer('"a string"', USER_ID)).toBeNull();
  });

  it("is null when ticketId is missing or not a number", () => {
    expect(readStoredTimer(JSON.stringify({ ...valid, ticketId: "4512" }), USER_ID)).toBeNull();
    const { ticketId: _ticketId, ...rest } = valid;
    expect(readStoredTimer(JSON.stringify(rest), USER_ID)).toBeNull();
  });

  it("is null when customerId is missing or not a number", () => {
    expect(readStoredTimer(JSON.stringify({ ...valid, customerId: "42" }), USER_ID)).toBeNull();
  });

  it("is null when ref is empty or not a string", () => {
    expect(readStoredTimer(JSON.stringify({ ...valid, ref: "" }), USER_ID)).toBeNull();
    expect(readStoredTimer(JSON.stringify({ ...valid, ref: "   " }), USER_ID)).toBeNull();
    expect(readStoredTimer(JSON.stringify({ ...valid, ref: 4512 }), USER_ID)).toBeNull();
  });

  it("is null when startedAt is not a parsable date", () => {
    expect(readStoredTimer(JSON.stringify({ ...valid, startedAt: "not-a-date" }), USER_ID)).toBeNull();
    expect(readStoredTimer(JSON.stringify({ ...valid, startedAt: 12345 }), USER_ID)).toBeNull();
  });

  it("is null when startedAt is meaningfully in the future (corrupt clock skew)", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(readStoredTimer(JSON.stringify({ ...valid, startedAt: future }), USER_ID)).toBeNull();
  });

  it("tolerates a few seconds of clock skew in the future", () => {
    const nearFuture = new Date(Date.now() + 2_000).toISOString();
    expect(readStoredTimer(JSON.stringify({ ...valid, startedAt: nearFuture }), USER_ID)).toEqual({
      ...valid,
      startedAt: nearFuture,
    });
  });
});
