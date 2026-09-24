import { describe, expect, it } from "vitest";
import type { ItopSettings } from "@/lib/queries";
import {
  buildItopSettingsPatch,
  buildItopTestInput,
  clampInt,
  formStateFromSettings,
  type ItopSettingsSnapshot,
} from "./itopSettingsDiff";

const SAVED: ItopSettingsSnapshot = {
  baseUrl: "https://itop.example.com",
  refreshMinutes: 5,
  readClasses: ["UserRequest", "Incident"],
  capacityHoursPerWeek: 40,
  actionsEnabled: false,
  timezone: "UTC",
};

function baseForm() {
  return {
    baseUrl: SAVED.baseUrl!,
    appToken: "",
    refreshMinutes: String(SAVED.refreshMinutes),
    readClasses: [...SAVED.readClasses],
    capacityHoursPerWeek: String(SAVED.capacityHoursPerWeek),
    actionsEnabled: SAVED.actionsEnabled,
    timezone: SAVED.timezone,
  };
}

describe("buildItopSettingsPatch", () => {
  it("returns an empty patch when nothing changed", () => {
    expect(buildItopSettingsPatch(baseForm(), SAVED)).toEqual({});
  });

  it("never includes appToken when the field is left blank", () => {
    const form = { ...baseForm(), appToken: "   " };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({});
  });

  it("includes appToken only when the admin typed a new one", () => {
    const form = { ...baseForm(), appToken: "brand-new-token" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({
      appToken: "brand-new-token",
    });
  });

  it("sends a changed baseUrl trimmed", () => {
    const form = { ...baseForm(), baseUrl: "  https://new.example.com  " };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({
      baseUrl: "https://new.example.com",
    });
  });

  it("clears baseUrl with null when the field is emptied", () => {
    const form = { ...baseForm(), baseUrl: "" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({ baseUrl: null });
  });

  it("treats a same-set-different-order readClasses as unchanged", () => {
    const form = {
      ...baseForm(),
      readClasses: ["Incident", "UserRequest"] as ItopSettingsSnapshot["readClasses"],
    };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({});
  });

  it("includes readClasses when the set actually changed", () => {
    const form = {
      ...baseForm(),
      readClasses: ["UserRequest"] as ItopSettingsSnapshot["readClasses"],
    };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({
      readClasses: ["UserRequest"],
    });
  });

  it("includes refreshMinutes, capacityHoursPerWeek, and actionsEnabled only when changed", () => {
    const form = {
      ...baseForm(),
      refreshMinutes: "10",
      capacityHoursPerWeek: "32",
      actionsEnabled: true,
    };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({
      refreshMinutes: 10,
      capacityHoursPerWeek: 32,
      actionsEnabled: true,
    });
  });

  it("combines several changed fields in one patch", () => {
    const form = { ...baseForm(), appToken: "tok12345", refreshMinutes: "15" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({
      appToken: "tok12345",
      refreshMinutes: 15,
    });
  });

  it("treats a null saved baseUrl the same as an empty string", () => {
    const saved: ItopSettingsSnapshot = { ...SAVED, baseUrl: null };
    const form = { ...baseForm(), baseUrl: "" };
    expect(buildItopSettingsPatch(form, saved)).toEqual({});
  });

  it("never marks an emptied refreshMinutes dirty with 0", () => {
    const form = { ...baseForm(), refreshMinutes: "" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({});
  });

  it("never marks a non-numeric capacityHoursPerWeek dirty", () => {
    const form = { ...baseForm(), capacityHoursPerWeek: "abc" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({});
  });

  it("clamps an out-of-range refreshMinutes into [1, 60] before diffing", () => {
    const form = { ...baseForm(), refreshMinutes: "999" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({ refreshMinutes: 60 });
  });

  it("clamps an out-of-range capacityHoursPerWeek into [1, 80] before diffing", () => {
    const form = { ...baseForm(), capacityHoursPerWeek: "0" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({ capacityHoursPerWeek: 1 });
  });

  it("includes timezone only when it changed", () => {
    const form = { ...baseForm(), timezone: "Europe/Paris" };
    expect(buildItopSettingsPatch(form, SAVED)).toEqual({ timezone: "Europe/Paris" });
  });

  it("omits timezone when it matches the saved value", () => {
    expect(buildItopSettingsPatch(baseForm(), SAVED)).not.toHaveProperty("timezone");
  });
});

describe("clampInt", () => {
  it("returns null for a blank string", () => {
    expect(clampInt("", 1, 60)).toBeNull();
    expect(clampInt("   ", 1, 60)).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(clampInt("abc", 1, 60)).toBeNull();
  });

  it("clamps below the minimum", () => {
    expect(clampInt("0", 1, 80)).toBe(1);
    expect(clampInt("-5", 1, 80)).toBe(1);
  });

  it("clamps above the maximum", () => {
    expect(clampInt("999", 1, 60)).toBe(60);
  });

  it("rounds a fractional value", () => {
    expect(clampInt("5.6", 1, 60)).toBe(6);
  });

  it("passes an in-range integer through unchanged", () => {
    expect(clampInt("40", 1, 80)).toBe(40);
  });
});

describe("buildItopTestInput", () => {
  it("sends nothing when the form matches the stored settings", () => {
    expect(buildItopTestInput(baseForm(), SAVED)).toEqual({});
  });

  it("forwards only the fields that differ from stored settings", () => {
    const form = { ...baseForm(), baseUrl: "https://staging.example.com", appToken: "tok12345" };
    expect(buildItopTestInput(form, SAVED)).toEqual({
      baseUrl: "https://staging.example.com",
      appToken: "tok12345",
    });
  });

  it("never leaks readClasses/refreshMinutes/etc. into the test body", () => {
    const form = { ...baseForm(), refreshMinutes: "20", capacityHoursPerWeek: "10" };
    expect(buildItopTestInput(form, SAVED)).toEqual({});
  });
});

describe("formStateFromSettings", () => {
  it("maps a saved ItopSettings response onto a blank-token form", () => {
    const settings: ItopSettings = {
      baseUrl: "https://itop.example.com",
      appTokenSet: true,
      webhookSecretSet: false,
      refreshMinutes: 5,
      readClasses: ["UserRequest", "Incident"],
      capacityHoursPerWeek: 40,
      actionsEnabled: false,
      timezone: "Europe/Paris",
      lastSyncAt: null,
      lastSyncOk: null,
      lastSyncError: null,
      lastFullSyncAt: null,
      updatedAt: "2026-09-22T00:00:00.000Z",
      updatedBy: null,
    };
    expect(formStateFromSettings(settings)).toEqual({
      baseUrl: "https://itop.example.com",
      appToken: "",
      refreshMinutes: "5",
      readClasses: ["UserRequest", "Incident"],
      capacityHoursPerWeek: "40",
      actionsEnabled: false,
      timezone: "Europe/Paris",
    });
  });

  it("maps a null baseUrl to an empty string", () => {
    const settings: ItopSettings = {
      baseUrl: null,
      appTokenSet: false,
      webhookSecretSet: false,
      refreshMinutes: 5,
      readClasses: ["UserRequest"],
      capacityHoursPerWeek: 40,
      actionsEnabled: false,
      timezone: "UTC",
      lastSyncAt: null,
      lastSyncOk: null,
      lastSyncError: null,
      lastFullSyncAt: null,
      updatedAt: "2026-09-22T00:00:00.000Z",
      updatedBy: null,
    };
    expect(formStateFromSettings(settings).baseUrl).toBe("");
  });
});
