import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SkeletonRegion } from "./SkeletonRegion";

/**
 * Kanban-shaped placeholder: `columns` lanes (default 3), each a header
 * strip plus a few card placeholders of varying height.
 */
const CARD_LINES = [2, 1, 2, 1];

export function BoardSkeleton({
  columns = 3,
  cardsPerColumn = 3,
  className,
  delayMs,
}: {
  columns?: number;
  cardsPerColumn?: number;
  className?: string;
  delayMs?: number;
}) {
  return (
    <SkeletonRegion className={cn("h-full", className)} delayMs={delayMs}>
      <div className="grid h-full gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, c) => (
          <div
            key={c}
            className="flex flex-col gap-3 rounded-sm border border-outline-variant bg-surface-container-low p-3"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-6 rounded-full" />
            </div>
            {Array.from({ length: cardsPerColumn }, (_, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-3"
              >
                <Skeleton className="h-4 w-11/12" />
                {CARD_LINES[(c + i) % CARD_LINES.length] === 2 && <Skeleton className="h-3 w-2/3" />}
                <div className="flex items-center justify-between pt-1">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="size-5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
