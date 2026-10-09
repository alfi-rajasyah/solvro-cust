// Count-chip filters for the Customer Tickets tab (Task 1.8): three
// mutually-exclusive scope chips (Ongoing / Resolved this week / Mine) and
// two independent class toggles (Incidents / Requests) — clicking an
// already-active class chip clears it, per
// docs/archive/plans/itop-integration-spec.md's mockup ("Filters are counts,
// so the tab answers 'how many?' before you read a row"). Toggle-pill visual
// borrowed from SolvroGantt.tsx's Baseline toggle (rounded-sm, since
// docs/DESIGN.md reserves `full` for chips/avatars; bg-primary/text-on-primary
// active state, aria-pressed carrying the state semantically).
import { cn } from "@/lib/utils";
import type { ItopTicketClass, ItopTicketCounts, ItopTicketScope } from "@/lib/queries";

const SCOPE_LABEL: Record<ItopTicketScope, string> = {
  ongoing: "Ongoing",
  resolved_week: "Resolved this week",
  mine: "Mine",
};

const PILL_BASE =
  "rounded-sm px-3 py-1 font-display text-meta font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/** Exported (fix round, phase review) so other Tickets-tab toggle controls
 * (e.g. `TicketsTab.tsx`'s Table|Board `ViewSwitch`) share the exact same
 * pill visual instead of a duplicated copy of this class string. */
export function pillClass(active: boolean): string {
  return cn(
    PILL_BASE,
    active
      ? "bg-primary text-on-primary"
      : "border border-outline-variant text-on-surface-variant hover:text-on-surface",
  );
}

export function TicketFilters({
  counts,
  scope,
  cls,
  onScopeChange,
  onClsChange,
  showScope = true,
}: {
  counts: ItopTicketCounts;
  scope: ItopTicketScope;
  cls?: ItopTicketClass;
  onScopeChange: (scope: ItopTicketScope) => void;
  onClsChange: (cls: ItopTicketClass | undefined) => void;
  /** `false` hides the Ongoing/Resolved this week/Mine scope-chip row —
   * the Board view (Task 6.1) always shows a fixed ongoing+resolved_week
   * set regardless of scope, so those chips would otherwise look live but
   * do nothing. Class chips (Incidents/Requests) stay either way — Board
   * does filter by class. Defaults `true` (Table view's existing behavior). */
  showScope?: boolean;
}) {
  function scopeChip(key: ItopTicketScope, count: number) {
    const active = scope === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => onScopeChange(key)}
        className={pillClass(active)}
      >
        {SCOPE_LABEL[key]} · {count}
      </button>
    );
  }

  function classChip(key: ItopTicketClass, label: string, count: number) {
    const active = cls === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => onClsChange(active ? undefined : key)}
        className={pillClass(active)}
      >
        {label} · {count}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ticket filters">
      {showScope && (
        <>
          {scopeChip("ongoing", counts.ongoing)}
          {scopeChip("resolved_week", counts.resolvedWeek)}
          {scopeChip("mine", counts.mine)}
          <span className="mx-1 h-4 w-px bg-outline-variant" aria-hidden="true" />
        </>
      )}
      {classChip("Incident", "Incidents", counts.incidents)}
      {classChip("UserRequest", "Requests", counts.requests)}
    </div>
  );
}
