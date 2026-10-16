// Username rule (2026-10 security hardening,
// docs/archive/plans/internal-sync.md): a username is
// NFKC-normalised and must consist of basic Latin letters, Latin-1 and
// Latin Extended-A letters (the accented forms of European names), digits,
// spaces and the separators . _ ' - only. That rejects look-alike
// characters from other scripts (Cyrillic "а" for Latin "a"), invisible
// characters, full-width forms (NFKC folds those to ASCII first), and the
// IPA / phonetic Latin blocks that hold most Latin-internal look-alikes
// (ɪ, ᴀ, ɑ, ǀ). The dotless i (ı, U+0131) is excluded by hand. Uniqueness
// is then checked case-insensitively by the caller (routes/admin.ts).
// Residual: a few look-alikes inside Latin-1/Extended-A remain (e.g. ĸ).

export const USERNAME_MAX = 50;

const USERNAME_RE = /^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u0130\u0132-\u017F ._'-]+$/u;

/**
 * Returns the normalised username, or null when the input breaks the rule
 * (empty, too long, or a character outside the allowed set).
 */
export function normalizeUsername(raw: string): string | null {
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > USERNAME_MAX) return null;
  if (!USERNAME_RE.test(name)) return null;
  return name;
}
