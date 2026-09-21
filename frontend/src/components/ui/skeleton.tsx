// Vendored from shadcn/ui: https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json
// Retrieved: 2026-08-01
// Hand-vendored (CLI banned for this repo's vendoring — root CLAUDE.md
// trap). Radix-free (no `dependencies`/`registryDependencies` in the
// registry response) — landed verbatim, no SOLVRO PATCH needed.
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
