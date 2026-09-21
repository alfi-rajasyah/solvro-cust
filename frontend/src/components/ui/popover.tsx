"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  // SOLVRO PATCH: optional className passthrough for PopoverPrimitive.Positioner.
  // Base-UI's Positioner carries an inline `transform`, which creates its own
  // stacking context — a z-index on the Popup (nested inside) can't escape
  // it. Callers that need the popover to outrank a z-100+ host layer (e.g.
  // Modal/Drawer) must set the z-index on the Positioner itself via this
  // prop. Default is unset (Positioner stays z-index:auto) so existing
  // callers (e.g. gantt-nav) are unaffected.
  positionerClassName,
  align = "center",
  sideOffset = 4,
  side,
  alignOffset,
  ...props
}: Omit<React.ComponentProps<typeof PopoverPrimitive.Popup>, "className"> &
  Pick<
    React.ComponentProps<typeof PopoverPrimitive.Positioner>,
    "align" | "sideOffset" | "side" | "alignOffset"
  > & { className?: string; positionerClassName?: string }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        side={side}
        alignOffset={alignOffset}
        // SOLVRO PATCH: see positionerClassName comment above.
        className={cn(positionerClassName)}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            // SOLVRO PATCH — upstream's bare `border` has no color source in
            // this codebase (no global border-color reset), so popups drew a
            // text-colored outline: near-white in dark, near-black in light.
            // `border-border` routes to the outline-variant hairline.
            "z-50 w-72 origin-(--transform-origin) rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof PopoverPrimitive.Title>, "className"> & {
  className?: string
}) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof PopoverPrimitive.Description>,
  "className"
> & { className?: string }) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
