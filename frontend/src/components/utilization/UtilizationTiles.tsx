// The Utilization page's three KPI tiles (Task 3.3): hours logged against
// capacity (with a utilisation bar), customers touched against how many are
// in scope, and hours not tied to any customer. Card styling follows the
// bordered `surface-container-lowest` tile pattern used elsewhere in the app
// (Executive.tsx's timeline rows, WeeklySync.tsx's table container) rather
// than the vendored `reui/badge`/`reui/card` — no precedent for those on a
// KPI tile row yet, and this stays a plain div to avoid pulling in a new
// dependency for three static numbers.
import type { ReactNode } from "react";
import type { UtilizationScope, UtilizationTilesData } from "@/lib/queries";
import { formatHours, utilisationPct } from "./utilizationPresentation";

function TileCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest px-4 py-3">
      <p className="font-display text-label-caps uppercase text-on-surface-variant">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function UtilizationTiles({
  tiles,
  scope,
}: {
  tiles: UtilizationTilesData;
  scope: UtilizationScope;
}) {
  const pct = utilisationPct(tiles.hoursLogged, tiles.capacityHours);
  // "At/over 100%" (not merely "over") — a TAM exactly at capacity is
  // already the state worth flagging, not just the one past it. Amber
  // (`chip-amber-text`, the app's "needs attention" tone — see
  // WeeklySync.tsx's "needs a manager decision" GroupHeader), not
  // `bg-error`/`bg-warning`: full capacity isn't a fault (that's what
  // Executive.tsx's `bg-error` overdue-bar reads as), and `bg-warning` is a
  // shadcn-bridge alias reserved for vendored components (docs/DESIGN.md
  // §1/§6), not app code.
  const atOrOverCapacity = tiles.capacityHours > 0 && tiles.hoursLogged >= tiles.capacityHours;
  const assignedLabel = scope === "me" ? "assigned to you" : "mapped";

  return (
    <div className="grid gap-4 sm:grid-cols-3" data-testid="utilization-tiles">
      <TileCard label="Hours logged">
        <p className="text-xl font-bold text-on-surface" data-testid="utilization-tile-hours">
          {formatHours(tiles.hoursLogged)}{" "}
          <span className="text-sm font-normal text-on-surface-variant">of {tiles.capacityHours} h</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-high">
          <div
            className={`h-full rounded-full ${atOrOverCapacity ? "bg-chip-amber-text" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </TileCard>

      <TileCard label="Customers touched">
        <p className="text-xl font-bold text-on-surface" data-testid="utilization-tile-customers">
          {tiles.customersTouched}{" "}
          <span className="text-sm font-normal text-on-surface-variant">
            of {tiles.customersAssigned} {assignedLabel}
          </span>
        </p>
      </TileCard>

      <TileCard label="Not tied to a customer">
        <p className="text-xl font-bold text-on-surface" data-testid="utilization-tile-unassigned">
          {formatHours(tiles.unassignedHours)} h
        </p>
        <p className="text-[12px] text-on-surface-variant">internal, no organisation on the entry</p>
      </TileCard>
    </div>
  );
}
