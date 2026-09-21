import * as React from "react"
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

// Hand-authored — NOT vendored from a registry response. Retrieved: n/a
// (2026-07-31 investigation date). This file is a registryDependency of the
// vendored `ui/button-group.tsx` (ButtonGroupSeparator). Both
// reui.io/r/separator.json and reui.io/r/styles/base-nova/separator.json
// 401 "Authentication required — provide your license key" (same gate as
// button-group/input/input-group/kbd/textarea); ui.shadcn.com's
// new-york-v4/separator.json IS reachable but imports its primitive from the
// headless-UI package this codebase does not use (root CLAUDE.md guardrail:
// never reintroduce it). Hand-authored here on @base-ui/react/separator
// instead. That package's separator also takes a `decorative` prop that
// @base-ui/react's Separator does not, so it is dropped from the surface
// here, mirroring how `ui/button.tsx` drops `asChild`/Slot.
//
// SOLVRO PATCH note: @base-ui/react's Separator always renders
// `role="separator"` — it has no `decorative` prop, so there is no
// `role="none"` mode (which the disallowed upstream package's version
// renders when `decorative` defaults true). Currently unexercised: no
// consumer passes an accessibility tree through this component yet.
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
