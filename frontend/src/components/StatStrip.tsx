import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * A page's summary numbers as one bordered row: number, then a sentence-case
 * label, an optional detail on the right. One component for every page that
 * opens with counts (Overview, Project Overview, Daily Review, Utilization,
 * Admin), replacing the per-page stat tile rows
 * (docs/archive/plans/stat-strip-project-header.md).
 *
 * Rules the component holds so callers cannot drift:
 * - no icon and no uppercase label;
 * - colour goes on the number only, and only for a tone that asks for action
 *   (`bad`, `warn`); pass the tone only when the value is above zero;
 * - a stat with `to` is a link to the list behind the number.
 *
 * From `md:` up it is one row; a label that does not fit its cell wraps onto
 * a second line, it never spills into the next cell. Below `md:` the cells
 * stack their number over the label in a grid (64px cells, so each link is a
 * full touch target). The detail shows from `lg:` up, except on a stat with
 * no number, where the detail is the only content and always shows. Keep `of` short ("of 12"):
 * it sits on the number's line and does not wrap.
 */
export type StatTone = "neutral" | "bad" | "warn";

export interface StatItem {
  /** Stable key, also the default `data-testid` suffix. */
  key: string;
  /** The number or short value ("14", "62%", "31.5 h"). Omit for a label-only stat. */
  value?: ReactNode;
  /** Denominator shown small after the value ("of 12"). */
  of?: string;
  /** Sentence-case label ("overdue tasks"). */
  label: string;
  /** Secondary text, right-aligned on desktop, hidden on phones. */
  detail?: ReactNode;
  /** 0 to 100: draws a small bar in place of the detail. */
  progress?: number;
  /** Bar colour when `progress` is set; amber marks "at or over capacity". */
  progressTone?: "primary" | "warn";
  tone?: StatTone;
  /** Makes the stat a link. */
  to?: string;
  /** Full accessible name when the visible text is too terse out of context. */
  ariaLabel?: string;
  testId?: string;
}

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-on-surface",
  bad: "text-error",
  warn: "text-chip-amber-text",
};

// Phone grid by item count, so no cell is left empty: three across for 3,
// two across for 2 and 4, and for 5 a six-track grid (three on the first
// row, two on the second).
function phoneGrid(count: number): { grid: string; span: (i: number) => string } {
  if (count === 5) {
    return { grid: "grid-cols-6", span: (i) => (i < 3 ? "col-span-2" : "col-span-3") };
  }
  if (count === 3) return { grid: "grid-cols-3", span: () => "" };
  if (count === 1) return { grid: "grid-cols-1", span: () => "" };
  return { grid: "grid-cols-2", span: () => "" };
}

export function StatStrip({
  items,
  className,
  testId,
  label,
}: {
  items: StatItem[];
  className?: string;
  testId?: string;
  /** Accessible name for the group, e.g. "Project summary". */
  label: string;
}) {
  const { grid, span } = phoneGrid(items.length);
  return (
    <ul
      // Preflight removes the list marker, and Safari then drops the list
      // role, so the role is stated.
      role="list"
      aria-label={label}
      data-testid={testId}
      // The 1px gap over an outline-coloured ground draws the hairlines, so
      // dividers stay correct however the cells wrap.
      className={cn(
        "grid gap-px overflow-hidden rounded-sm border border-outline-variant bg-outline-variant md:flex",
        grid,
        className,
      )}
    >
      {items.map((item, i) => {
        const body = (
          <>
            {item.value !== undefined && (
              <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span
                  data-testid={item.testId ? `${item.testId}-value` : undefined}
                  className={cn("text-xl font-bold tabular-nums", VALUE_TONE[item.tone ?? "neutral"])}
                >
                  {item.value}
                </span>
                {item.of && <span className="text-xs text-on-surface-variant">{item.of}</span>}
              </span>
            )}
            <span className="min-w-0 text-meta font-semibold text-on-surface md:text-xs">
              {item.label}
            </span>
            {item.progress !== undefined ? (
              <span
                aria-hidden="true"
                className="hidden h-1 w-20 shrink overflow-hidden rounded-full bg-surface-container-high md:ml-auto md:block md:self-center"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    item.progressTone === "warn" ? "bg-chip-amber-text" : "bg-primary",
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                />
              </span>
            ) : (
              item.detail !== undefined && (
                <span
                  className={cn(
                    // shrink-[99]: when a cell is tight the detail gives way
                    // (and truncates) before the label has to wrap.
                    "min-w-0 shrink-[99] truncate text-meta text-on-surface-variant md:ml-auto lg:block",
                    // A stat with no number has only its detail to say
                    // anything ("Baseline: not locked"), so it always shows.
                    // Otherwise the detail appears from `lg:`, where a cell
                    // has room for it.
                    item.value === undefined ? "block" : "hidden",
                  )}
                >
                  {item.detail}
                </span>
              )
            )}
          </>
        );
        const cell =
          "flex min-h-16 min-w-0 flex-col justify-center gap-0 overflow-hidden bg-surface-container-lowest px-3 py-2 md:min-h-0 md:flex-row md:items-baseline md:justify-start md:gap-2 md:px-4 md:py-2.5";
        return (
          <li key={item.key} className={cn("min-w-0 md:flex-1", span(i))}>
            {item.to ? (
              <Link
                to={item.to}
                aria-label={item.ariaLabel}
                data-testid={item.testId}
                className={cn(
                  cell,
                  "h-full outline-hidden transition-colors hover:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                )}
              >
                {body}
              </Link>
            ) : (
              <div data-testid={item.testId} className={cn(cell, "h-full")}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
