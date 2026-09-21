// Vendored from shadcn/ui: https://ui.shadcn.com/r/styles/new-york-v4/input-group.json
// Retrieved: 2026-07-31
// Hand-vendored because reui.io's own registry (this component's official
// registryDependency source for @reui/filters) 401s "Authentication required
// — provide your license key" for this item at both the bare and
// style-prefixed paths. `input-group` is a generic shadcn/ui primitive, not
// a ReUI-authored component (confirmed via ReUI's own component catalogue),
// so the canonical, license-free upstream registry is used instead. Content
// below is the registry item's file content verbatim except for the marked
// SOLVRO PATCH hand-edits.
"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        // SOLVRO PATCH — DESIGN.md §4: no shadows outside overlays; dropped
        // `shadow-xs`. DESIGN.md §1: the group root carries the same
        // deepest-inset surface as standalone Input/Textarea (was transparent
        // in light and `input/30` in dark, which made grouped controls sit on
        // a different surface from every other text field).
        "group/input-group relative flex w-full items-center rounded-md border border-input bg-surface-container-lowest transition-[color,box-shadow] outline-none",
        "h-9 min-w-0 has-[>textarea]:h-auto",

        // Variants based on alignment.
        "has-[>[data-align=inline-start]]:[&>input]:pl-2",
        "has-[>[data-align=inline-end]]:[&>input]:pr-2",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3",

        // Focus state.
        // SOLVRO PATCH — DESIGN.md §4: 2px primary focus outline is the
        // app-wide contract (see CustomerFormModal.tsx/TaskFormModal.tsx's
        // hand-written inputs). Replaced `border-ring`/`ring-[3px]`/
        // `ring-ring/50` with the canonical 2px/30%-opacity treatment.
        "has-[[data-slot=input-group-control]:focus-visible]:border-primary has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-primary/30",

        // Error state.
        "has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-destructive/20 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40",

        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  // SOLVRO PATCH — DESIGN.md §3: the upstream arbitrary radius, `calc(var(--radius) - 5px)`, computes
  // to 0 here (this codebase has no `--radius` custom property — radii are
  // fixed Tailwind tokens, see index.css's `@theme` block); replaced with the
  // flat `rounded-sm` token (0.25rem) instead of introducing `--radius`.
  "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-sm [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]",
        "inline-end":
          "order-last pr-3 has-[>button]:mr-[-0.45rem] has-[>kbd]:mr-[-0.35rem]",
        "block-start":
          "order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-2.5 [.border-b]:pb-3",
        "block-end":
          "order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-2.5 [.border-t]:pt-3",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva("flex items-center gap-2 text-sm shadow-none", {
  variants: {
    size: {
      // SOLVRO PATCH — DESIGN.md §3: the upstream arbitrary radius, `calc(var(--radius) - 5px)`,
      // computes to 0 (no `--radius` custom property in this codebase);
      // replaced with the flat `rounded-sm` token (0.25rem).
      xs: "h-6 gap-1 rounded-sm px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
      sm: "h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5",
      // SOLVRO PATCH — same `--radius` fix as above.
      "icon-xs": "size-6 rounded-sm p-0 has-[>svg]:p-0",
      "icon-sm": "size-8 p-0 has-[>svg]:p-0",
    },
  },
  defaultVariants: {
    size: "xs",
  },
})

// SOLVRO PATCH — registry targets React 19 where `ref` is a plain prop; this
// repo is React 18. Same two-level forwarding as InputGroupInput below: this
// wrapper must forward its own ref down into Button (itself forwardRef'd) or
// `render=` slots receive null.
const InputGroupButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentProps<typeof Button>, "size"> &
    VariantProps<typeof inputGroupButtonVariants>
>(({ className, type = "button", variant = "ghost", size = "xs", ...props }, ref) => {
  return (
    <Button
      ref={ref}
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
})
InputGroupButton.displayName = "InputGroupButton"

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

// SOLVRO PATCH — registry targets React 19 where `ref` is a plain prop; this
// repo is React 18. Wrapping the leaf `ui/input.tsx#Input` in forwardRef is
// not enough on its own — InputGroupInput is itself a separate function
// component sitting between callers and `Input`, so it must also forward its
// ref through to `Input` for a ref passed to InputGroupInput (e.g.
// reui/filters.tsx's `<InputGroupInput ref={inputRef} .../>`) to reach the
// DOM node.
const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, ...props }, ref) => {
  return (
    <Input
      ref={ref}
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
})
InputGroupInput.displayName = "InputGroupInput"

// SOLVRO PATCH — same React 18 forwardRef fix as InputGroupInput above.
const InputGroupTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <Textarea
      ref={ref}
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
})
InputGroupTextarea.displayName = "InputGroupTextarea"

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
