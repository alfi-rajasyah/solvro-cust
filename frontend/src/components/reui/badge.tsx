// Vendored from ReUI: https://reui.io/r/badge.json
// Retrieved: 2026-08-01
// Content below is the registry item's file content verbatim except for the
// marked SOLVRO PATCH hand-edits (focus-ring normalization; dropped the
// undefined "focus" tone and its "-light"/"-outline" siblings; rerouted the
// "-light"/"-outline" tint variants off this codebase's undefined
// "-foreground" tokens onto the base tone).
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center w-fit border border-transparent font-medium whitespace-nowrap outline-none transition-shadow",
    // SOLVRO PATCH — DESIGN.md §4: the one focus treatment app-wide is
    // `focus-visible:border-primary focus-visible:ring-2
    // focus-visible:ring-primary/30` (Button/Input/Textarea precedent).
    // Replaced upstream's `focus-visible:ring-2 focus-visible:ring-ring
    // focus-visible:ring-offset-1 focus-visible:ring-offset-background`.
    "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border-border bg-transparent dark:bg-input/32",
        secondary: "bg-secondary text-secondary-foreground",
        // SOLVRO PATCH — `info`/`success`/`warning`/`destructive` NOT FOR
        // USE until the Phase 4 chip rebase. `--color-info`/`-success`/
        // `-warning` are calibrated as text-on-tint colors (Alert's existing
        // usage: `text-success` on `bg-success/10`), not vivid solid-fill
        // colors — as a *solid* full-opacity background with `text-white`
        // on top, dark-mode contrast measures ≈1.2-1.3:1 (near-invisible).
        // `destructive` is a milder case, not the same failure: white on
        // dark-mode `--error` (`#f87171`) measures ≈2.8:1 — below AA but
        // not near-invisible — and it is NOT the same combination
        // `ui/button.tsx`'s destructive variant ships, despite sharing the
        // `bg-{tone} text-white` shape: Button adds `dark:bg-destructive/60`
        // (mixing the fill toward the surface, raising contrast further),
        // which this Badge variant does not carry, so it still falls short
        // of Button's precedent and stays constrained here too. These TONE
        // variants have zero consumers today — only `secondary`/`outline`
        // are consumed, by `data-grid-column-filter.tsx`'s selected-count
        // chips — flagged for whoever wires one of the tone variants up
        // before Phase 4 decides on a real solid-fill tone family.
        info: "bg-info text-white",
        success: "bg-success text-white",
        warning: "bg-warning text-white",
        destructive: "bg-destructive text-white",
        // SOLVRO PATCH — upstream's "focus" tone (`bg-focus`/`text-focus-
        // foreground`) has no home in this codebase: it's not even in this
        // registry item's own `cssVars` (only destructive-foreground/
        // success/success-foreground/info/info-foreground/warning/warning-
        // foreground/invert/invert-foreground are declared there), and
        // DESIGN.md's Alert-bridge migration only wired success/warning/
        // info/invert. Dropped this variant and its "-light"/"-outline"
        // siblings below rather than invent an undefined token.
        invert: "bg-invert text-invert-foreground",
        "primary-light":
          "border-primary/10 bg-primary/10 text-primary dark:border-primary/25 dark:bg-primary/15 dark:text-primary",
        // SOLVRO PATCH — this registry item's own cssVars define a distinct
        // "-foreground" shade per tone (e.g. `success-foreground` = a darker
        // emerald than `success`, for readability on a light tinted fill).
        // This codebase only wires the single base token per tone (DESIGN.md
        // §1's Alert bridge: --color-success/-warning/-info), so `-light`/
        // `-outline` variants below use the base tone as text color instead
        // — same convention as Chip/StatusChip (same-hue text on a tint of
        // that hue). `destructive-foreground` IS defined here (= on-error,
        // white/near-black for text on a *solid* destructive fill) but using
        // it on these *tinted* (10-15% opacity) backgrounds would be
        // low-contrast-to-invisible, so it's swapped too for consistency.
        "warning-light":
          "border-warning/15 bg-warning/10 text-warning dark:border-warning/25 dark:bg-warning/15 dark:text-warning",
        "success-light":
          "border-success/15 bg-success/10 text-success dark:border-success/25 dark:bg-success/15 dark:text-success",
        "info-light":
          "border-info/15 bg-info/10 text-info dark:border-info/25 dark:bg-info/15 dark:text-info",
        "destructive-light":
          "border-destructive/15 bg-destructive/10 text-destructive dark:border-destructive/25 dark:bg-destructive/15 dark:text-destructive",
        "invert-light":
          "border-invert/15 bg-invert/10 text-foreground dark:border-invert/45 dark:bg-invert/35 dark:text-invert-foreground",
        "primary-outline":
          "bg-background border-border text-primary dark:bg-input/30",
        "warning-outline":
          "bg-background border-border text-warning dark:bg-input/30",
        "success-outline":
          "bg-background border-border text-success dark:bg-input/30",
        "info-outline":
          "bg-background border-border text-info dark:bg-input/30",
        "destructive-outline":
          "bg-background border-border text-destructive dark:bg-input/30",
        "invert-outline":
          "bg-background border-border text-invert-foreground dark:bg-input/30",
      },
      size: {
        xs: "px-1 py-0.25 text-[0.6rem] leading-none h-4 min-w-4 gap-1",
        sm: "px-1 py-0.25 text-[0.625rem] leading-none h-4.5 min-w-4.5 gap-1",
        default: "px-1.25 py-0.5 text-xs h-5 min-w-5 gap-1",
        lg: "px-1.5 py-0.5 text-xs h-5.5 min-w-5.5 gap-1",
        xl: "px-2 py-0.75 text-sm h-6 min-w-6 gap-1.5",
      },
      /** `default`: active style radius. `full`: pill radius. */
      radius: {
        default:
          "rounded-sm",
        full: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      radius: "default",
    },
  }
)

interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"]
  size?: VariantProps<typeof badgeVariants>["size"]
  radius?: VariantProps<typeof badgeVariants>["radius"]
}

function Badge({
  className,
  variant,
  size,
  radius,
  render,
  ...props
}: BadgeProps) {
  const defaultProps = {
    "data-slot": "badge",
    className: cn(badgeVariants({ variant, size, radius, className })),
  }

  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(defaultProps, props),
  })
}

export { Badge, badgeVariants, type BadgeProps }
