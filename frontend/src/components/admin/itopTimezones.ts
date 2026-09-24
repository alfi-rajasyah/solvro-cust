// Pure helper for the Admin "iTop" tab's Connection card timezone `<select>`
// (fix, 2026-09-24). Extracted from ItopTab.tsx (review fix round) so the
// grouping logic is unit-testable without mounting the component or
// stubbing `Intl` globals — callers pass in whatever `Intl` gives them (or
// doesn't) rather than this module calling `Intl.supportedValuesOf`/
// `Intl.DateTimeFormat` itself.
//
// A short hardcoded list, used only when the runtime has no
// `Intl.supportedValuesOf` at all — true for some of Vite's default build
// targets (Safari 14, Chrome 87, Firefox 78; `esnext.intl`/`es2022.intl`
// landed later). Deliberately small: it exists so the picker still offers
// *something* useful on those targets, not to be a complete zone list.
const FALLBACK_TIMEZONES: readonly string[] = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Warsaw",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Jakarta",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
];

export interface TimezoneGroup {
  region: string;
  zones: string[];
}

/**
 * Builds the region-grouped timezone list for the timezone `<select>`.
 *
 * `extraZones` are unconditionally unioned in even when they're not part of
 * `supportedZones` — closing two gaps found in review:
 * 1. The already-saved zone can be an alias (`US/Eastern`, `Etc/GMT+5`) that
 *    `Intl.supportedValuesOf("timeZone")` doesn't enumerate even though the
 *    backend's own `isValidTimeZone` (and `Intl.DateTimeFormat` itself)
 *    accept it — without unioning it in, the select would silently render
 *    blank instead of showing the saved value. Empty strings (e.g. before
 *    the settings form has loaded) are ignored, not turned into a bogus
 *    zone/group.
 * 2. `supportedZones` itself can be empty (the runtime has no
 *    `Intl.supportedValuesOf`), in which case `FALLBACK_TIMEZONES` is used
 *    instead so the picker isn't left with only "UTC" and whatever
 *    `extraZones` happened to carry.
 *
 * "UTC" is always present and its group is always sorted first — it's the
 * backend's own default for an unconfigured install, so it shouldn't be
 * buried after e.g. "Pacific" in an alphabetical region sort.
 */
export function buildTimezoneGroups(
  extraZones: readonly string[],
  supportedZones: readonly string[] = [],
): TimezoneGroup[] {
  const source = supportedZones.length > 0 ? supportedZones : FALLBACK_TIMEZONES;
  const all = new Set<string>(["UTC", ...source]);
  for (const zone of extraZones) {
    if (zone) all.add(zone);
  }

  const byRegion = new Map<string, string[]>();
  for (const zone of all) {
    const region = zone.includes("/") ? zone.split("/")[0]! : "UTC";
    const bucket = byRegion.get(region);
    if (bucket) {
      bucket.push(zone);
    } else {
      byRegion.set(region, [zone]);
    }
  }

  const groups = [...byRegion.entries()]
    .map(([region, zones]) => ({ region, zones: zones.sort() }))
    .sort((a, b) => a.region.localeCompare(b.region));

  const utcIndex = groups.findIndex((g) => g.region === "UTC");
  if (utcIndex > 0) {
    const [utc] = groups.splice(utcIndex, 1);
    groups.unshift(utc!);
  }
  return groups;
}
