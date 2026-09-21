import { Chip } from "@/components/StatusChip";
import { cn } from "@/lib/utils";

// Single spec for the manual Critical Path mark — reused by every surface
// (Gantt tree, Kanban card, Timeline card, List row, task panel, task form).
// See docs/plans/critical-path-mark.md §3.
export const CRITICAL_PATH_LABEL = "Critical Path";
export const CRITICAL_PATH_HELPER_TEXT = "Slip here moves the end date.";
export const CRITICAL_PATH_GLYPH = "conversion_path";

/**
 * `variant="chip"` — a violet `Chip` (glyph + label) for card/panel surfaces.
 * Always the compact padding — every call site wants it, so there's no
 * non-compact branch to keep in sync.
 * `variant="glyph"` — the bare glyph, for tight spaces like list rows.
 */
export function CriticalPathMark({
  variant,
  className,
}: {
  variant: "chip" | "glyph";
  /** Extra layout classes for the host surface (e.g. wrap/shrink behavior). */
  className?: string;
}) {
  if (variant === "glyph") {
    return (
      <span
        role="img"
        // Google Fonts' `.material-symbols-outlined { font-size: 24px }` is
        // unlayered and beats Tailwind v4's layered `text-[14px]` — force it
        // with the `!` important-utility suffix (see `DateRangeField.tsx`'s
        // `shadow-overlay!`) rather than fighting cascade order.
        className={cn(
          "material-symbols-outlined inline-flex items-center text-[14px]! leading-none text-chip-violet-text",
          className,
        )}
        title={CRITICAL_PATH_LABEL}
        aria-label={CRITICAL_PATH_LABEL}
      >
        {CRITICAL_PATH_GLYPH}
      </span>
    );
  }

  // `Chip` has no padding prop and no className passthrough (StatusChip.tsx
  // is user-gated, untouched here). The wrapper is `flex` (never the bare
  // `<span>` default of `inline`) — an inline wrapper still generates its
  // own line box per the *ambient* font/line-height it's dropped into,
  // adding phantom leading on top of Chip's own height (review finding).
  // `[&>span]:px-1.5` targets Chip's own root span — a class + direct-child
  // -type selector, which outranks the plain `.px-2` utility on specificity
  // alone, so the override is safe regardless of Tailwind's generated CSS
  // order. Mirrors PriorityBadge's compact form (px-2 → px-1.5) without
  // touching the shared component.
  return (
    <span className={cn("flex [&>span]:px-1.5", className)}>
      <Chip tone="violet">
        {/* Same unlayered-font-size cascade issue as the glyph variant
            above — `!` forces the 13px size instead of Google Fonts'
            24px default. */}
        <span
          aria-hidden="true"
          className="material-symbols-outlined inline-flex items-center text-[13px]! leading-none"
        >
          {CRITICAL_PATH_GLYPH}
        </span>
        {CRITICAL_PATH_LABEL}
      </Chip>
    </span>
  );
}
