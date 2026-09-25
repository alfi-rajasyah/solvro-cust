import type { Epic } from "@/lib/queries";
import { pickContrast } from "@/lib/contrast";

/**
 * Epic chip — the epic's color as the background with a computed contrast
 * text tone, same treatment as `LabelChip`. Truncates long titles so it fits
 * a Kanban card or a List row; the full title is in the tooltip.
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
  const fg = pickContrast(epic.color);
  return (
    <span
      data-testid="epic-chip"
      data-epic-id={epic.id}
      title={epic.title}
      className={`inline-flex max-w-[160px] items-center truncate rounded-full font-display text-[11px] font-semibold leading-[18px] ${compact ? "px-1.5 py-0.5" : "px-2 py-0.5"} ${className}`}
      style={{ backgroundColor: epic.color, color: fg }}
    >
      <span className="truncate">{epic.title}</span>
    </span>
  );
}
