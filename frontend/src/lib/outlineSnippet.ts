// Outline search results arrive with the snippet already split into text
// segments (`{ text, highlight }`; the server reduces Outline's `<b>` markup to
// that, docs/archive/plans/outline-integration.md F9). The client renders every
// segment as TEXT - highlighted ones inside a <mark> element - and never feeds
// Outline content to innerHTML. This helper only normalises what it was given.

export interface OutlineSnippetSegment {
  text: string;
  highlight: boolean;
}

/**
 * Keeps well-formed segments, folds line breaks and runs of whitespace into
 * single spaces (a snippet is one or two lines in a row, not a paragraph), merges
 * neighbours of the same kind and trims the outer edges. Anything that is not an
 * array of `{ text: string, highlight: boolean }` yields no segments.
 */
export function normalizeSnippet(input: unknown): OutlineSnippetSegment[] {
  if (!Array.isArray(input)) return [];
  const out: OutlineSnippetSegment[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const { text, highlight } = raw as { text?: unknown; highlight?: unknown };
    if (typeof text !== "string") continue;
    const folded = text.replace(/\s+/g, " ");
    if (folded === "") continue;
    const flag = highlight === true;
    const prev = out[out.length - 1];
    if (prev && prev.highlight === flag) prev.text += folded;
    else out.push({ text: folded, highlight: flag });
  }
  if (out.length > 0) {
    out[0].text = out[0].text.replace(/^ +/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, "");
  }
  return out.filter((s) => s.text !== "");
}

/** The snippet as plain text (what a screen reader and a test see). */
export function snippetText(segments: readonly OutlineSnippetSegment[]): string {
  return segments.map((s) => s.text).join("");
}
