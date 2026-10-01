import type { Label } from "@/lib/queries";

/**
 * Label chip — the user's colour is a dot plus a 14% tint of the same
 * colour; the text is always `on-surface`, so any stored colour stays
 * readable in both themes. The colour is user data, hence the inline style.
 */
export function LabelChip({ label, compact = false }: { label: Label; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-display text-meta font-semibold leading-[18px] text-on-surface ${compact ? "px-1.5 py-0.5" : "px-2 py-0.5"}`}
      style={{ backgroundColor: `color-mix(in srgb, ${label.color} 14%, transparent)` }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      {label.name}
    </span>
  );
}
