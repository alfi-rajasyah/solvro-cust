// Vendored from shadcn/ui: https://ui.shadcn.com/r/styles/new-york-v4/button-group.json
// Retrieved: 2026-07-31
// Hand-vendored because reui.io's own registry (this component's official
// registryDependency source for @reui/filters) 401s "Authentication required
// — provide your license key" for this item at both the bare and
// style-prefixed paths. `button-group` is a generic shadcn/ui primitive, not
// a ReUI-authored component (confirmed via ReUI's own component catalogue),
// so the canonical, license-free upstream registry is used instead. Content
// below is the registry item's file content verbatim except for the marked
// SOLVRO PATCH hand-edits.
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

const buttonGroupVariants = cva(
  "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        vertical:
          "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  }
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

// SOLVRO PATCH — upstream's `asChild` (a Slot primitive from the
// headless-UI package this codebase does not use) is dropped, same as
// `ui/button.tsx`'s precedent: the root guardrail forbids reintroducing
// that package, and nothing in this codebase composes ButtonGroupText via
// asChild. Always renders a `<div>`.
function ButtonGroupText({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // SOLVRO PATCH — DESIGN.md §4: no shadows outside overlays; dropped
        // `shadow-xs` (this is a toolbar chip, not an overlay surface).
        "flex items-center gap-2 rounded-md border bg-muted px-4 text-sm font-medium [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "relative m-0! self-stretch bg-input data-[orientation=vertical]:h-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
}
