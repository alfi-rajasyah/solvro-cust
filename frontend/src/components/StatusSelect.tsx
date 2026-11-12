import { cn } from "@/lib/utils";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CHIP_BASE, STATUS_TONE_DOT_CLASS, statusToneClass, type StatusDisplay } from "@/components/StatusChip";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_CATEGORY_GROUP_LABEL } from "@/lib/labels";
import { type TaskStatus, type TaskStatusDef, useTaskStatuses } from "@/lib/queries";
import { STATUS_CATEGORY_ICON, groupStatusDefs } from "@/lib/taskStatuses";

// The one task-status picker (docs/archive/plans/custom-task-statuses.md §3 B2):
// workspace statuses grouped under their category, a colour dot per status, the
// current one checked. Built on the Base-UI Select, so arrow keys, type-ahead,
// Enter/Escape and the listbox roles come for free.
//
// `value` is a status id. `fallback` is what to show before the list has loaded
// (or when the id is no longer listed) — pass the task's own `statusDef`.
// `variant="chip"` renders the trigger as the status pill (panel header, list
// row); "field" is a bordered form control.
export function StatusSelect({
  value,
  fallback,
  onChange,
  disabled = false,
  variant = "field",
  ariaLabel = "Status",
  className,
  align = "start",
}: {
  value: number | null;
  fallback?: (StatusDisplay & { category: TaskStatus }) | null;
  onChange: (def: TaskStatusDef) => void;
  disabled?: boolean;
  variant?: "chip" | "field";
  ariaLabel?: string;
  className?: string;
  /** Which edge of the trigger the list lines up with (`end` near the right edge of the screen). */
  align?: "start" | "end";
}) {
  const { data: defs } = useTaskStatuses();
  const current = defs?.find((d) => d.id === value) ?? null;
  const shown: (StatusDisplay & { category: TaskStatus }) | null = current ?? fallback ?? null;
  const groups = groupStatusDefs(defs);
  const items = (defs ?? []).map((d) => ({ value: String(d.id), label: d.name }));

  const chipClass = cn(
    CHIP_BASE,
    "max-w-full min-w-0",
    shown ? statusToneClass(shown, shown.category) : "bg-surface-container-high text-on-surface-variant",
  );

  // Read-only chip: no control at all, exactly the chip.
  if (variant === "chip" && disabled) {
    return shown ? <span className={cn(chipClass, className)} title={shown.name}>
        <span className="truncate">{shown.name}</span>
      </span> : null;
  }

  return (
    <Select
      items={items}
      value={current ? String(current.id) : null}
      onValueChange={(v) => {
        const def = defs?.find((d) => String(d.id) === v);
        if (def && def.id !== value) onChange(def);
      }}
      disabled={disabled || !defs}
    >
      {variant === "chip" ? (
        <SelectPrimitive.Trigger
          aria-label={ariaLabel}
          data-slot="status-select-trigger"
          title={shown?.name}
          className={cn(chipClass, "tap-target cursor-pointer outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default", className)}
        >
          <span className="truncate">{shown?.name ?? "Status"}</span>
          <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-meta">expand_more</span>
        </SelectPrimitive.Trigger>
      ) : (
        <SelectTrigger size="sm" aria-label={ariaLabel} className={cn("[@media(pointer:coarse)]:min-h-11", className)}>
          {current ? <SelectValue /> : <span>{shown?.name ?? "Status"}</span>}
        </SelectTrigger>
      )}
      {/* Opens below the trigger, capped and scrollable (same as Overview's
          pickers); z-101 so it also works inside Modal.tsx's z-100 layer. */}
      <SelectContent
        side="bottom"
        align={align}
        alignItemWithTrigger={false}
        positionerClassName="z-101"
        className="max-h-[min(var(--available-height),20rem)] min-w-48 shadow-overlay!"
      >
        {groups.map((g) => (
          <SelectGroup key={g.category}>
            <SelectLabel className="flex items-center gap-1.5 font-display text-label-caps uppercase text-on-surface-variant">
              <span aria-hidden="true" className="material-symbols-outlined text-base">
                {STATUS_CATEGORY_ICON[g.category]}
              </span>
              {TASK_CATEGORY_GROUP_LABEL[g.category]}
            </SelectLabel>
            {g.defs.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full ${STATUS_TONE_DOT_CLASS[d.color]}`}
                  />
                  {d.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
