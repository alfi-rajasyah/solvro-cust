// Vendored from shadcn/ui: https://ui.shadcn.com/r/styles/new-york-v4/input.json
// Retrieved: 2026-07-31
// Hand-vendored because reui.io's own registry (this component's official
// registryDependency source for @reui/filters) 401s "Authentication required
// — provide your license key" for this item at both the bare and
// style-prefixed paths. `input` is a generic shadcn/ui primitive, not a
// ReUI-authored component (confirmed via ReUI's own component catalogue), so
// the canonical, license-free upstream registry is used instead. Content
// below is the registry item's file content verbatim except for the marked
// SOLVRO PATCH hand-edits.
import * as React from "react"

import { cn } from "@/lib/utils"

// SOLVRO PATCH — registry targets React 19 where `ref` is a plain prop on
// function components; this repo is React 18.3.1, where a plain function
// component silently drops any ref passed to it (no forwarding, no warning
// past a dev-mode console notice). Wrapped in React.forwardRef so callers
// (e.g. reui/filters.tsx's combobox inputs) get a real DOM node back.
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          // SOLVRO PATCH — DESIGN.md §4: no shadows outside overlays; dropped
          // `shadow-xs`. DESIGN.md §1: inputs are the deepest inset surface
          // — `rounded-md`/`bg-transparent`/`dark:bg-input/30` replaced with
          // `rounded-sm`/`bg-surface-container-lowest` (the token already
          // flips per-theme, so no separate `dark:` override is needed).
          "h-9 w-full min-w-0 rounded-sm border border-input bg-surface-container-lowest px-3 py-1 text-base transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          // SOLVRO PATCH — DESIGN.md §4: 2px primary focus outline is the
          // app-wide contract (see CustomerFormModal.tsx/TaskFormModal.tsx's
          // hand-written inputs). Replaced `focus-visible:border-ring
          // focus-visible:ring-[3px] focus-visible:ring-ring/50` with the
          // canonical 2px/30%-opacity treatment.
          "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
