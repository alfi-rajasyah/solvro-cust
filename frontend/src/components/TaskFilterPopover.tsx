import { useId, type ReactNode } from "react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Epic, Label } from "@/lib/queries";
import type { EpicFilter, TaskFilters } from "@/lib/taskFilters";

const SELECT_CLASS =
  "[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container px-2 py-1.5 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";
const FIELD_LABEL = "mb-1 block text-label-caps uppercase text-on-surface-variant";

function epicToValue(epic: EpicFilter): string {
  return epic === "all" ? "" : epic === "none" ? "none" : String(epic);
}

function valueToEpic(v: string): EpicFilter {
  return v === "" ? "all" : v === "none" ? "none" : Number(v);
}

interface TaskFilterPopoverProps {
  filters: TaskFilters;
  onChange: (patch: Partial<TaskFilters>) => void;
  onClear: () => void;
  /** Number shown in the trigger badge; 0 hides it. */
  activeCount: number;
  epics: Epic[];
  /** The project's labels; omit to hide the Label control (Gantt, Timeline). */
  labels?: Label[];
  /** Extra controls (the board's Assignee and Priority) rendered above Epic. */
  children?: ReactNode;
  /** Classes for the trigger button; receives whether any filter is active. */
  triggerClassName: (active: boolean) => string;
}

/**
 * The Filter button and popover shared by List, Kanban, Gantt and Timeline:
 * same trigger, same Epic select, same Clear link, so the four views read as
 * one control. The state itself lives in the URL (`hooks/useTaskFilters.ts`).
 *
 * Built on the Base-UI popover: focus moves in on open, Tab stays inside, and
 * Escape or an outside press closes it and returns focus to the Filter button.
 */
export function TaskFilterPopover({
  filters,
  onChange,
  onClear,
  activeCount,
  epics,
  labels,
  children,
  triggerClassName,
}: TaskFilterPopoverProps) {
  const labelGroupId = useId();
  const epicSelectId = useId();
  const active = activeCount > 0;

  function toggleLabel(id: number) {
    onChange({
      labelIds: filters.labelIds.includes(id)
        ? filters.labelIds.filter((x) => x !== id)
        : [...filters.labelIds, id],
    });
  }

  return (
    <Popover modal="trap-focus">
      <PopoverTrigger className={triggerClassName(active)}>
        <span aria-hidden="true" className="material-symbols-outlined text-base">filter_alt</span>
        Filter
        {active && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-meta leading-none font-bold text-on-primary">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      {/* The positioner keeps the panel inside the viewport (collisionPadding), so
          at 375px it widens to the screen minus the 16px gutters like the old sheet. */}
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        positionerClassName="z-50"
        className="max-h-(--available-height) w-64 overflow-y-auto rounded-sm border-outline-variant bg-surface-container-lowest p-3 text-on-surface shadow-overlay max-md:w-[calc(100vw-2rem)]"
      >
        {children}
        <div className="mb-3">
          <label htmlFor={epicSelectId} className={FIELD_LABEL}>
            Epic
          </label>
          <select
            id={epicSelectId}
            value={epicToValue(filters.epic)}
            onChange={(e) => onChange({ epic: valueToEpic(e.target.value) })}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            <option value="none">No epic</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </div>
        {labels && (
          <div className="mb-3">
            <span id={labelGroupId} className={FIELD_LABEL}>
              Label
            </span>
            <div
              role="group"
              aria-labelledby={labelGroupId}
              className="max-h-40 overflow-y-auto rounded-sm border border-outline-variant bg-surface-container py-1"
            >
              <label className="[@media(pointer:coarse)]:min-h-11 flex cursor-pointer items-center gap-2 px-2 py-1 text-sm text-on-surface hover:bg-surface-container-high">
                <input
                  type="checkbox"
                  checked={filters.noLabel}
                  onChange={(e) => onChange({ noLabel: e.target.checked })}
                  className="accent-primary"
                />
                <span className="italic text-on-surface-variant">No label</span>
              </label>
              {labels.map((l) => (
                <label
                  key={l.id}
                  className="[@media(pointer:coarse)]:min-h-11 flex cursor-pointer items-center gap-2 px-2 py-1 text-sm text-on-surface hover:bg-surface-container-high"
                >
                  <input
                    type="checkbox"
                    checked={filters.labelIds.includes(l.id)}
                    onChange={() => toggleLabel(l.id)}
                    className="accent-primary"
                  />
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="min-w-0 truncate">{l.name}</span>
                </label>
              ))}
              {labels.length === 0 && (
                <p className="px-2 py-1 text-meta text-on-surface-variant">No labels in this project yet.</p>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          {active ? (
            <button
              type="button"
              onClick={onClear}
              className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 rounded-sm text-xs font-semibold text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              Clear filters
            </button>
          ) : (
            <span />
          )}
          <PopoverClose className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 rounded-sm text-xs font-semibold text-on-surface-variant outline-hidden hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary">
            Done
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
