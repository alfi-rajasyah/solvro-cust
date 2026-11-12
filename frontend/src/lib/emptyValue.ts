/**
 * The mark shown where a value is missing (an empty table cell, a fact with
 * nothing recorded). One constant so every screen uses the same character:
 * an en dash, never an em dash or a hyphen. Render it as text, e.g.
 * `{row.owner ?? EMPTY_VALUE}`.
 */
export const EMPTY_VALUE = "–";
