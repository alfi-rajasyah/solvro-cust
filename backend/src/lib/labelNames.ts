// The one definition of "the same label name" for the cross-project label
// features (GET /labels and the GET /tasks `labelName` filter): trimmed and
// lower-cased in JS. A label saved before names were trimmed can still hold
// surrounding spaces, and both routes must group and match it as its trimmed
// name. Never compare in SQL (`ILIKE` reads `_` and `%` as wildcards, and
// Postgres `lower()` can disagree with `toLowerCase()` outside ASCII).
export function labelNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The spelling shown to a user: the stored name without surrounding spaces. */
export function labelNameDisplay(name: string): string {
  return name.trim();
}
