import { useEffect, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateToDay, dayToDate, formatDisplay } from "@/lib/dateField";
import { cn } from "@/lib/utils";

interface DateFieldProps {
  /**
   * Plain calendar day, `"yyyy-MM-dd"` — no time, no timezone. Null = unset.
   * NOT an ISO instant: an earlier version of this contract carried the ISO
   * instant directly, converting through local midnight on every pick —
   * east of UTC that walked the displayed day back one calendar day.
   * Callers that persist ISO timestamps translate at the boundary via
   * `isoFromDay`/`dayFromIso`/`commitDraft` from that module.
   */
  value: string | null;
  onChange: (day: string | null) => void;
  disabled?: boolean;
  /** "boxed" = bordered inline-editor look (default). "bare" = borderless FieldRow text. */
  variant?: "boxed" | "bare";
  /** Renders a "Clear" action under the calendar. */
  clearable?: boolean;
  /** Pass-through for react-day-picker props, e.g. disabled-day matchers, defaultMonth. */
  calendarProps?: Partial<
    Omit<React.ComponentProps<typeof Calendar>, "mode" | "selected" | "onSelect">
  >;
  /** Extra classes on the trigger button. */
  className?: string;
  "aria-label"?: string;
  /**
   * Display-only override for the trigger's rendered text. For call sites
   * whose resting label must use a different format than the picker's own
   * day contract (`formatDisplay`'s `dd/MM/yyyy`) — e.g. a row/card that
   * shows a short local-format date elsewhere and needs this trigger to
   * match it byte-for-byte rather than diverge into a second display
   * format for the same underlying value. When provided (including as an
   * empty string), replaces `formatDisplay(value) || "—"` in the trigger;
   * `value`/`onChange`/`commitDraft` semantics are completely untouched —
   * this only changes what's rendered, never what the picker or its
   * caller compute from.
   */
  triggerLabel?: string;
}

const triggerBaseClasses =
  "cursor-pointer text-left focus:outline-hidden disabled:cursor-default";

const variantClasses = {
  boxed:
    "rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 font-mono text-[12px] text-on-surface focus:border-primary",
  bare: "border-none bg-transparent text-xs font-semibold text-on-surface",
} as const;

/**
 * Shared calendar-popover date field replacing native `<input type="date">`
 * sites. Composes ui/calendar.tsx inside ui/popover.tsx, the same pattern as
 * `reui/gantt/gantt-nav.tsx`'s `GanttDatePicker` (validated to render
 * correctly in dark mode without edits to ui/calendar.tsx).
 *
 * Traffics in plain calendar days (`"yyyy-MM-dd"`), not ISO instants — see
 * the `value`/`onChange` doc above and `frontend/src/lib/dateField.ts`'s
 * module comment for why. Internally, `dayToDate` parses the day string as
 * local midnight for the Calendar, and `dateToDay` re-derives the day string
 * from the Calendar's local Y/M/D on select.
 */
export function DateField({
  value,
  onChange,
  disabled = false,
  variant = "boxed",
  clearable = false,
  calendarProps,
  className,
  "aria-label": ariaLabel,
  triggerLabel,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const date = dayToDate(value);

  function handleSelect(day: Date | undefined) {
    if (day === undefined) {
      // react-day-picker fires onSelect(undefined) when the user re-clicks
      // the already-selected day. Always treat this as close-only — never
      // wipe the value from a re-click swallow, `clearable` or not.
      // `clearable` only controls whether the explicit Clear button (below)
      // is rendered; it must not also let a re-click silently clear the
      // field with no undo (mirrors reui/gantt/gantt-nav.tsx:401-406's
      // `if (next)` guard, generalized to apply regardless of `clearable`).
      // Clearing the value is `handleClear`'s job alone.
      setOpen(false);
      return;
    }
    onChange(dateToDay(day));
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setOpen(false);
  }

  // Single source of truth for "is the popover actually visible" — feeds the
  // Popover's `open` prop below. Kept as its own derivation (rather than
  // inlining `open && !disabled` there) because `disabled` can flip true
  // while `open` state is still true — see the reset effect right below —
  // and this is what lets the popup collapse immediately in that case.
  const isOpen = open && !disabled;

  // If `disabled` flips true while the popover is open, force `open` back
  // to false so the popup can't resurrect once `disabled` clears again.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // No document-level Escape listener here. One used to live in this file
  // (a capture-phase `document` keydown handler calling
  // stopImmediatePropagation()) to guard against Base-UI's dismissing
  // Escape reaching bubble-phase host listeners (Drawer/Modal's own
  // Escape-to-close) — that was itself the fix for a keyboard-unclosable
  // trap in an earlier round. Empirically re-measured (2026-07-28, plan
  // Task 2) at a real call site (TaskPanel's DATES editor): Base-UI's own
  // Popover dismiss already prevents the dismissing Escape keydown from
  // reaching document-level host listeners, so the capture listener was
  // dead complexity duplicating behavior Base-UI provides for free.
  // `open={isOpen}` / `onOpenChange={setOpen}` below is sufficient — Escape
  // closes only the popover, and a second Escape reaches the host shell.

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={
          ariaLabel ?? (value ? `Select date, currently ${formatDisplay(value)}` : "Select date")
        }
        className={cn(triggerBaseClasses, variantClasses[variant], className)}
      >
        {triggerLabel !== undefined ? triggerLabel || "—" : formatDisplay(value) || "—"}
      </PopoverTrigger>
      <PopoverContent align="start" positionerClassName="z-101" className="w-auto p-0! shadow-overlay">
        <Calendar
          {...calendarProps}
          mode="single"
          selected={date ?? undefined}
          defaultMonth={calendarProps?.defaultMonth ?? date ?? undefined}
          onSelect={handleSelect}
        />
        {clearable ? (
          <div className="flex justify-end border-t border-outline-variant p-1">
            <button
              type="button"
              onClick={handleClear}
              className="rounded-sm px-1.5 py-0.5 font-display text-sm text-on-surface-variant hover:bg-surface-container font-semibold"
            >
              Clear
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
