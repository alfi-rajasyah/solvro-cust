import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "@/lib/utils";

/**
 * Row and header selection box for the List's bulk edit. Not `ui/checkbox`:
 * that one draws a check for the indeterminate state too, and a header box
 * that is half-selected needs a dash. Material Symbols per the app-chrome rule.
 */
export function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  /** Accessible name; the box has no visible text. */
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn("flex items-center justify-center [@media(pointer:coarse)]:size-11", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <CheckboxPrimitive.Root
        checked={checked}
        indeterminate={indeterminate}
        onCheckedChange={() => onChange()}
        aria-label={label}
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-outline bg-surface-container-lowest outline-hidden transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 data-checked:border-primary data-checked:bg-primary data-checked:text-on-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-on-primary"
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">
            {indeterminate ? "remove" : "check"}
          </span>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    </span>
  );
}
