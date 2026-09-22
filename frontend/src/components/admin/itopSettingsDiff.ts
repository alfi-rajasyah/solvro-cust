// Pure helper for the Admin "iTop" tab's Connection card (Task 1.6): builds
// a PATCH /admin/itop/settings payload containing only the fields the admin
// actually changed, so an untouched field is never re-sent (in particular,
// an empty "Application token" field always means "keep the stored token" —
// it must never clear it by accident). Extracted from ItopTab.tsx so the
// diffing logic is unit-testable without mounting the component.
import type {
  ItopReadClass,
  ItopSettings,
  ItopTestConnectionInput,
  UpdateItopSettingsInput,
} from "@/lib/queries";

export interface ItopSettingsFormState {
  baseUrl: string;
  /** Empty string = keep the stored token; never sent when blank. */
  appToken: string;
  /**
   * Raw input text, not a number — a controlled `<input type="number">`
   * bound to a `number` field can't represent "the box is momentarily
   * empty while the admin is retyping it", and coercing on every keystroke
   * (`Number("")` → `0`) both fights the user's backspace and made an
   * emptied field silently diff as a real change to `0`. Parsed/clamped by
   * `clampInt` at diff time (below) and again on blur (ItopTab.tsx).
   */
  refreshMinutes: string;
  readClasses: ItopReadClass[];
  /** Same raw-string rationale as refreshMinutes. */
  capacityHoursPerWeek: string;
  actionsEnabled: boolean;
}

// The subset of ItopSettings the diff is computed against — deliberately
// narrower than the full response (no appTokenSet/lastSync*/etc.), since the
// form never round-trips those fields.
export type ItopSettingsSnapshot = Pick<
  ItopSettings,
  "baseUrl" | "refreshMinutes" | "readClasses" | "capacityHoursPerWeek" | "actionsEnabled"
>;

export function formStateFromSettings(saved: ItopSettings): ItopSettingsFormState {
  return {
    baseUrl: saved.baseUrl ?? "",
    appToken: "",
    refreshMinutes: String(saved.refreshMinutes),
    readClasses: saved.readClasses,
    capacityHoursPerWeek: String(saved.capacityHoursPerWeek),
    actionsEnabled: saved.actionsEnabled,
  };
}

function sameReadClasses(a: ItopReadClass[], b: ItopReadClass[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((c) => setB.has(c));
}

/**
 * Parses a raw number-input string to an integer clamped to `[min, max]`.
 * Returns `null` for blank/non-numeric input — callers treat `null` as
 * "no valid value yet" (diffing: don't send it; blur: fall back to the last
 * saved value) rather than coercing it to `0`.
 */
export function clampInt(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Diffs the editable form against the last-saved snapshot and returns only
 * the changed fields, ready to send as the PATCH body. An untouched
 * `appToken` (left blank) is never included — that is the "keep" contract
 * PATCH /admin/itop/settings relies on (routes/itopAdmin.ts). A
 * blank/invalid `refreshMinutes`/`capacityHoursPerWeek` is likewise never
 * included — an in-progress edit (the field momentarily empty) must not be
 * mistaken for "the admin wants 0".
 */
export function buildItopSettingsPatch(
  form: ItopSettingsFormState,
  saved: ItopSettingsSnapshot,
): UpdateItopSettingsInput {
  const patch: UpdateItopSettingsInput = {};

  const trimmedBaseUrl = form.baseUrl.trim();
  const savedBaseUrl = saved.baseUrl ?? "";
  if (trimmedBaseUrl !== savedBaseUrl) {
    patch.baseUrl = trimmedBaseUrl === "" ? null : trimmedBaseUrl;
  }

  const trimmedToken = form.appToken.trim();
  if (trimmedToken !== "") {
    patch.appToken = trimmedToken;
  }

  const refreshMinutes = clampInt(form.refreshMinutes, 1, 60);
  if (refreshMinutes !== null && refreshMinutes !== saved.refreshMinutes) {
    patch.refreshMinutes = refreshMinutes;
  }

  if (!sameReadClasses(form.readClasses, saved.readClasses)) {
    patch.readClasses = form.readClasses;
  }

  const capacityHoursPerWeek = clampInt(form.capacityHoursPerWeek, 1, 80);
  if (capacityHoursPerWeek !== null && capacityHoursPerWeek !== saved.capacityHoursPerWeek) {
    patch.capacityHoursPerWeek = capacityHoursPerWeek;
  }

  if (form.actionsEnabled !== saved.actionsEnabled) {
    patch.actionsEnabled = form.actionsEnabled;
  }

  return patch;
}

/**
 * "Test connection" sends the form's baseUrl/appToken only when they differ
 * from what's stored (reusing the same diff so "changed" means the same
 * thing in both places); otherwise an empty body tells the backend to use
 * the stored settings (routes/itopAdmin.ts POST /test).
 */
export function buildItopTestInput(
  form: ItopSettingsFormState,
  saved: ItopSettingsSnapshot,
): ItopTestConnectionInput {
  const patch = buildItopSettingsPatch(form, saved);
  const input: ItopTestConnectionInput = {};
  if (typeof patch.baseUrl === "string") input.baseUrl = patch.baseUrl;
  if (typeof patch.appToken === "string") input.appToken = patch.appToken;
  return input;
}
