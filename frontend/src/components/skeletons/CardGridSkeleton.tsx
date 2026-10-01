import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SkeletonRegion } from "./SkeletonRegion";

/**
 * `count` card placeholders (title line, two body lines, a footer chip row)
 * in a grid. Pass `gridClassName` to change the column layout, e.g.
 * "grid-cols-1" for a stacked list or a single section card.
 */
export function CardGridSkeleton({
  count = 6,
  className,
  gridClassName = "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
  announce,
  delayMs,
}: {
  count?: number;
  className?: string;
  gridClassName?: string;
  announce?: boolean;
  delayMs?: number;
}) {
  return (
    <SkeletonRegion className={className} announce={announce} delayMs={delayMs}>
      <div className={cn("grid gap-3", gridClassName)}>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-4"
          >
            <Skeleton className="h-4 w-2/3" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
