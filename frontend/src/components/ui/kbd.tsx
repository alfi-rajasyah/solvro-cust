// Vendored from shadcn/ui: https://ui.shadcn.com/r/styles/new-york-v4/kbd.json
// Retrieved: 2026-07-31
// Hand-vendored because reui.io's own registry (this component's official
// registryDependency source for @reui/filters) 401s "Authentication required
// — provide your license key" for this item at both the bare and
// style-prefixed paths. `kbd` is a generic shadcn/ui primitive, not a
// ReUI-authored component (confirmed via ReUI's own component catalogue), so
// the canonical, license-free upstream registry is used instead. Content
// below is the registry item's file content verbatim — no hand-edits needed.
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
