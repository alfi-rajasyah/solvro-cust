import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRegion } from "./SkeletonRegion";

/**
 * Project detail shell while the project loads: facts row with action
 * buttons, tab strip, then a content block.
 */
export function ProjectPageSkeleton({ delayMs }: { delayMs?: number }) {
  return (
    <SkeletonRegion className="flex h-full flex-col gap-4" delayMs={delayMs}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
      <div className="flex items-center gap-4 border-b border-outline-variant pb-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      <Skeleton className="min-h-64 flex-1" />
    </SkeletonRegion>
  );
}
