// Shared building blocks for the Weekly Sync row and its two form modals
// (docs/archive/plans/weekly-sync-tables.md §4 "Daily Review", T5): the
// label/control/helper wrapper every Mid-week/Reflection field uses
// (`SyncField`), and the Health radiogroup + its style map (`HEALTH_CLASS`,
// `HealthButtonGroup`), reused as-is between `MidweekSyncModal.tsx` and
// `ReflectionSyncModal.tsx`. `HEALTH_CLASS` and `WEEKLY_STATUS_BADGE` are
// also the single shared source for the health pill / status badge classes
// rendered by `CustomerGroup.tsx`'s own header, `WeeklySyncRow.tsx`, and
// the Weekly Sync page (`pages/WeeklySync.tsx`) — import from here rather
// than redefining either map.
import type { ReactNode } from "react";
import type { BadgeProps } from "@/components/reui/badge";
import { ButtonGroup } from "@/components/ui/button-group";
import { WEEKLY_HEALTH_LABEL, WEEKLY_STATUS_LABEL } from "@/lib/labels";
import type { WeeklyHealth, WeeklyStatus } from "@/lib/queries";

export const WEEKLY_STATUS_BADGE: Record<WeeklyStatus, { label: string; variant: BadgeProps["variant"] }> = {
  NOT_STARTED: { label: WEEKLY_STATUS_LABEL.NOT_STARTED, variant: "outline" },
  DRAFT: { label: WEEKLY_STATUS_LABEL.DRAFT, variant: "warning-light" },
  DONE: { label: WEEKLY_STATUS_LABEL.DONE, variant: "success-light" },
};

export const HEALTH_CLASS: Record<WeeklyHealth, string> = {
  GREEN: "bg-chip-emerald-bg text-chip-emerald-text",
  AMBER: "bg-chip-amber-bg text-chip-amber-text",
  RED: "bg-chip-rose-bg text-chip-rose-text",
};

const HEALTH_OPTIONS: { value: WeeklyHealth; label: string; className: string }[] = [
  { value: "GREEN", label: WEEKLY_HEALTH_LABEL.GREEN, className: HEALTH_CLASS.GREEN },
  { value: "AMBER", label: WEEKLY_HEALTH_LABEL.AMBER, className: HEALTH_CLASS.AMBER },
  { value: "RED", label: WEEKLY_HEALTH_LABEL.RED, className: HEALTH_CLASS.RED },
];

export interface HealthButtonGroupProps {
  value: WeeklyHealth | null;
  onChange: (value: WeeklyHealth) => void;
}

/** The Green/Amber/Red radiogroup both sync modals use to set `health` — always enabled (no `disabled` mode, unlike the old WeeklyUpdateBlock.tsx). */
export function HealthButtonGroup({ value, onChange }: HealthButtonGroupProps) {
  return (
    <ButtonGroup role="radiogroup" aria-label="Health">
      {HEALTH_OPTIONS.map((h) => {
        const selected = value === h.value;
        return (
          <button
            key={h.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(h.value)}
            className={[
              "rounded-sm border border-outline-variant px-2.5 py-1 text-[12px] font-semibold transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              selected ? h.className : "bg-surface-container-lowest text-on-surface-variant hover:text-on-surface",
            ].join(" ")}
          >
            {h.label}
          </button>
        );
      })}
    </ButtonGroup>
  );
}

export interface SyncFieldProps {
  /** Wired to the control's own `id` via `htmlFor` — pass the same id to both. */
  id: string;
  label: ReactNode;
  /** Right-aligned slot next to the label — the "Draft from …" action links. */
  action?: ReactNode;
  helper?: string;
  children: ReactNode;
}

/** Label-caps `<label>` + control + optional 11px helper line, shared by every field in both sync modals. */
export function SyncField({ id, label, action, helper, children }: SyncFieldProps) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="block font-display text-label-caps uppercase tracking-widest text-on-surface-variant"
        >
          {label}
        </label>
        {action}
      </div>
      {children}
      {helper && <p className="mt-1 text-xs text-on-surface-variant">{helper}</p>}
    </div>
  );
}
