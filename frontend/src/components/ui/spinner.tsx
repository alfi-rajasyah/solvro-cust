// Vendored from shadcn/ui: https://ui.shadcn.com/r/styles/new-york-v4/spinner.json
// Retrieved: 2026-08-01
// Hand-vendored (CLI banned for this repo's vendoring — root CLAUDE.md
// trap). Radix-free (`dependencies: ["class-variance-authority"]` only) —
// landed verbatim, no SOLVRO PATCH needed.
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
