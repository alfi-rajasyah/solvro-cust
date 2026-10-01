import type { Epic } from "@/lib/queries";

/**
 * Epic chip — the epic's colour as a dot plus a 14% tint, `on-surface` text,
 * same treatment as `LabelChip`. Truncates long titles so it fits a Kanban
 * card or a List row; the full title is in the tooltip.
 */
export function EpicChip({
  epic,
  compact = false,
  className = "",
}: {
  epic: Pick<Epic, "id" | "title" | "color">;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      data-testid="epic-chip"
      data-epic-id={epic.id}
      title={epic.title}
      className={`inline-flex max-w-[160px] items-center gap-1.5 truncate rounded-full font-display text-meta font-semibold leading-[18px] text-on-surface ${compact ? "px-1.5 py-0.5" : "px-2 py-0.5"} ${className}`}
      style={{ backgroundColor: `color-mix(in srgb, ${epic.color} 14%, transparent)` }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: epic.color }}
      />
      <span className="truncate">{epic.title}</span>
    </span>
  );
}
