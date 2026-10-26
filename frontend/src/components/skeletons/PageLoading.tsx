import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SkeletonRegion } from "./SkeletonRegion";

/**
 * Suspense fallback while a lazily loaded page's code arrives (App.tsx). From
 * the service-worker cache this is a few milliseconds, so the body only paints
 * after the shared skeleton delay; screen readers still hear "Loading…".
 */
export function PageLoading({ className }: { className?: string }) {
  return (
    <SkeletonRegion className={cn("flex flex-col gap-3", className)} data-testid="page-loading">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-40 w-full" />
    </SkeletonRegion>
  );
}
