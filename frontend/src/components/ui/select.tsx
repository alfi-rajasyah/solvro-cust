// Hand-authored — NOT vendored from a registry response. Retrieved: n/a
// (2026-08-01 investigation date). This is a registryDependency of the
// vendored `reui/data-grid/data-grid-pagination.tsx` (rows-per-page
// dropdown). Both reui.io/r/select.json and
// reui.io/r/styles/base-nova/select.json 401 "Authentication required —
// provide your license key" (same gate as button-group/input/input-group/
// kbd/separator/textarea). ui.shadcn.com's new-york-v4/select.json IS
// reachable but depends on `radix-ui` (root CLAUDE.md guardrail: never
// reintroduce it) — confirmed via `dependencies: ["radix-ui"]` in that
// registry response. Hand-authored here on @base-ui/react/select instead,
// following ui/separator.tsx's precedent. Base UI's Select anatomy (Root >
// Trigger > Value/Icon, Portal > Positioner > Popup > List > Item >
// ItemText/ItemIndicator) differs structurally from Radix's single
// `Content`/`Viewport` pair — confirmed against the installed
// @base-ui/react package's type declarations and base-ui.com's docs.
//
// Surface deliberately scoped to what data-grid-pagination.tsx (this vendor
// task's only current consumer) actually imports: Select, SelectTrigger
// (with its `size` prop), SelectValue, SelectContent (with `align` and
// `alignItemWithTrigger`), SelectItem. No Group/Label/Separator/scroll-arrow
// wrappers — nothing in this repo consumes them yet; extend the surface (and
// this comment) when a real consumer needs one, per the plan's Risk note:
// "keep the surface minimal; anything structural → stop-and-report."
"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        // SOLVRO PATCH — modeled on ui/input.tsx: DESIGN.md §1 treats form
        // controls as the deepest inset surface (`rounded-sm` +
        // `bg-surface-container-lowest`, not upstream's `rounded-md`
        // `bg-transparent`/`dark:bg-input/30`); DESIGN.md §4 drops the
        // `shadow-xs` upstream ships and normalizes the focus treatment to
        // the canonical `focus-visible:border-primary focus-visible:ring-2
        // focus-visible:ring-primary/30` (was `focus-visible:border-ring
        // focus-visible:ring-[3px] focus-visible:ring-ring/50`).
        "flex w-fit items-center justify-between gap-2 rounded-sm border border-input bg-surface-container-lowest px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectContent({
  className,
  align = "center",
  alignItemWithTrigger,
  sideOffset = 4,
  side,
  alignOffset,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.List> &
  Pick<
    React.ComponentProps<typeof SelectPrimitive.Positioner>,
    "align" | "alignItemWithTrigger" | "sideOffset" | "side" | "alignOffset"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        sideOffset={sideOffset}
        side={side}
        alignOffset={alignOffset}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            // SOLVRO PATCH — upstream's bare `border` has no color source in
            // this codebase (no global border-color reset — see
            // ui/popover.tsx's precedent); `border-border` routes to the
            // outline-variant hairline. Radius set to `rounded-md`, matching
            // ui/popover.tsx's and ui/dropdown-menu.tsx's Popup radius (both
            // sibling vendored popup surfaces use `rounded-md`, not
            // `rounded-sm` — this file originally diverged from that, fixed
            // in review). `shadow-md` is kept deliberately: it's the same
            // treatment ui/popover.tsx's and ui/dropdown-menu.tsx's Popups
            // already carry (DESIGN.md §4's shadow-outside-overlays ban is
            // about card/hover-lift shadows; a floating popup surface is an
            // overlay by definition, and this repo hasn't yet reconciled
            // that with §4's `shadow-overlay`-whitelist token — pending a
            // global popup-shadow decision, tracked as a gap rather than
            // fixed ad hoc here). `z-50` follows ui/popover.tsx's/
            // ui/dropdown-menu.tsx's precedent (on the Popup, not the
            // Positioner — frontend/CLAUDE.md's z-101 override convention
            // only applies when a caller needs to outrank the Modal layer;
            // no current consumer needs that here).
            "z-50 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            className
          )}
        >
          <SelectPrimitive.List className="p-1" {...props}>
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
