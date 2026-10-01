// Base-UI-backed switch primitive (frontend/CLAUDE.md: "Headless stack is
// Base-UI"). `@base-ui/react` already ships a `switch` module — no new
// dependency, just a styled wrapper, same pattern as the other `ui/*.tsx`
// primitives (see checkbox.tsx). First consumer: the Admin "iTop" tab's
// "Actions from Solvro" control (Task 5.2, docs/archive/plans/
// itop-integration.md), replacing the inert `DisabledSwitch` placeholder.
import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "className"> & {
  className?: string;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-outline-variant bg-surface-container-high transition-colors outline-none data-checked:border-primary data-checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-surface-bright transition-transform data-checked:translate-x-[18px]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
