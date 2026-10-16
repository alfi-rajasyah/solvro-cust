// Turns an Outline search `context` (HTML with `<b>` highlights, F9) into plain
// text segments. Only `<b>`/`</b>` are understood; every other tag is dropped
// (script/style including their contents), entities are decoded, and the result
// is data the client renders as TEXT - Outline HTML never reaches the browser.

export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi, (whole, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
    return String.fromCodePoint(code);
  });
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

export function parseSearchContext(context: unknown, maxLength = 600): SnippetSegment[] {
  if (typeof context !== "string") return [];
  // Drop script/style blocks wholesale so their bodies cannot surface as text.
  const cleaned = context.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const segments: SnippetSegment[] = [];
  let depth = 0;
  let last = 0;
  let produced = 0;

  const push = (raw: string) => {
    const text = decodeEntities(raw);
    if (text === "" || produced >= maxLength) return;
    const clipped = text.slice(0, maxLength - produced);
    produced += clipped.length;
    const highlight = depth > 0;
    const prev = segments[segments.length - 1];
    if (prev && prev.highlight === highlight) prev.text += clipped;
    else segments.push({ text: clipped, highlight });
  };

  for (const m of cleaned.matchAll(TAG)) {
    push(cleaned.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2].toLowerCase() === "b") depth = m[1] === "/" ? Math.max(0, depth - 1) : depth + 1;
  }
  push(cleaned.slice(last));
  return segments;
}
