import type { Label } from "@/lib/queries";
import { pickContrast } from "@/lib/contrast";

export function LabelChip({ label, compact = false }: { label: Label; compact?: boolean }) {
  const fg = pickContrast(label.color);
  return (
    <span
      className={`inline-flex items-center rounded-full font-display text-[11px] font-semibold leading-[18px] ${compact ? "px-1.5 py-0.5" : "px-2 py-0.5"}`}
      style={{ backgroundColor: label.color, color: fg }}
    >
      {label.name}
    </span>
  );
}
