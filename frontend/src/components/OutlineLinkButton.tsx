import { safeOutlineHref } from "@/lib/outlineUrl";

// Header action that opens a project's / customer's Outline page in a new tab.
// Renders nothing for an empty or non-http(s) value, so a header can mount it
// unconditionally (docs/archive/plans/outline-integration.md §3).
export function OutlineLinkButton({
  url,
  className = "",
}: {
  url: string | null | undefined;
  className?: string;
}) {
  const href = safeOutlineHref(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="outline-link"
      className={[
        "h-8 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-display text-xs font-bold text-on-surface hover:bg-surface-container outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30",
        className || "inline-flex",
      ].join(" ")}
    >
      <span className="material-symbols-outlined text-base" aria-hidden="true">
        menu_book
      </span>
      Outline
      <span
        className="material-symbols-outlined text-base text-on-surface-variant"
        aria-hidden="true"
      >
        open_in_new
      </span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
