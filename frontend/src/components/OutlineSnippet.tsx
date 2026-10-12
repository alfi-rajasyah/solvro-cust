import { normalizeSnippet, type OutlineSnippetSegment } from "@/lib/outlineSnippet";

// A search snippet from Outline: plain-text segments, the matched words inside a
// <mark>. Every segment is rendered as a React text child - Outline content never
// reaches innerHTML (docs/archive/plans/outline-integration.md, F9).
export function OutlineSnippet({
  segments,
  className = "",
}: {
  segments: readonly OutlineSnippetSegment[];
  className?: string;
}) {
  const clean = normalizeSnippet(segments);
  if (clean.length === 0) return null;
  return (
    <span className={className} data-testid="outline-snippet">
      {clean.map((s, i) =>
        s.highlight ? (
          <mark key={i} className="rounded-xs bg-primary/20 px-0.5 font-semibold text-on-surface">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
