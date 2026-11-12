// The Utilization page's summary strip (Task 3.3): hours logged against
// capacity (with a utilisation bar), customers touched against how many are
// in scope, and hours not tied to any customer. One shared StatStrip; the
// test ids stay on the cells (`utilization-tile-*`).
import { StatStrip, type StatItem } from "@/components/StatStrip";
import type { UtilizationScope, UtilizationTilesData } from "@/lib/queries";
import { formatHours, utilisationPct } from "./utilizationPresentation";

export function UtilizationTiles({
  tiles,
  scope,
}: {
  tiles: UtilizationTilesData;
  scope: UtilizationScope;
}) {
  const pct = utilisationPct(tiles.hoursLogged, tiles.capacityHours);
  // "At/over 100%" (not merely "over") — a TAM exactly at capacity is
  // already the state worth flagging, not just the one past it. Amber is the
  // app's "needs attention" tone; full capacity isn't a fault, so not red.
  const atOrOverCapacity = tiles.capacityHours > 0 && tiles.hoursLogged >= tiles.capacityHours;
  const scopeDetail = scope === "me" ? "of those assigned to you" : "of those mapped";

  const items: StatItem[] = [
    {
      key: "hours",
      value: formatHours(tiles.hoursLogged),
      of: `of ${tiles.capacityHours} h`,
      label: "hours logged",
      progress: pct,
      progressTone: atOrOverCapacity ? "warn" : "primary",
      tone: atOrOverCapacity ? "warn" : "neutral",
      testId: "utilization-tile-hours",
    },
    {
      key: "customers",
      value: tiles.customersTouched,
      of: `of ${tiles.customersAssigned}`,
      label: "customers touched",
      detail: scopeDetail,
      testId: "utilization-tile-customers",
    },
    {
      key: "unassigned",
      value: `${formatHours(tiles.unassignedHours)} h`,
      label: "not tied to a customer",
      detail: "internal, no organisation on the entry",
      tone: tiles.unassignedHours > 0 ? "warn" : "neutral",
      testId: "utilization-tile-unassigned",
    },
  ];
  return <StatStrip items={items} label="Utilization summary" testId="utilization-tiles" />;
}
