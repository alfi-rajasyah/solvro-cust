import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SkeletonRegion } from "./SkeletonRegion";

/**
 * Bordered table placeholder: a header strip plus `rows` rows of `columns`
 * cells. `widths` (Tailwind width classes, one per column) shapes the cells
 * to the real table; the first column is the widest by default.
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  widths,
  className,
  announce,
  delayMs,
}: {
  rows?: number;
  columns?: number;
  widths?: string[];
  className?: string;
  announce?: boolean;
  delayMs?: number;
}) {
  const cellWidth = (c: number) => widths?.[c] ?? (c === 0 ? "w-3/4" : "w-1/2");
  return (
    <SkeletonRegion className={className} announce={announce} delayMs={delayMs}>
      <div className="overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest">
        <div
          className="grid items-center gap-4 border-b border-outline-variant bg-surface-container-low px-3 py-2.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            className={cn(
              "grid items-center gap-4 px-3 py-3",
              r < rows - 1 && "border-b border-outline-variant",
            )}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className={cn("h-4", cellWidth(c))} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
