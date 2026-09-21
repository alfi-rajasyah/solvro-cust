import type { Priority } from "@/lib/queries";

type Tone = "gray" | "amber" | "rose";

const TONE_CLASS: Record<Tone, string> = {
  gray: "bg-surface-container-high text-on-surface-variant",
  amber: "bg-chip-amber-bg text-chip-amber-text",
  rose: "bg-chip-rose-bg text-chip-rose-text",
};

const TONE: Record<Priority, Tone> = {
  LOW: "gray",
  MEDIUM: "gray",
  HIGH: "amber",
  URGENT: "rose",
};

const LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Med",
  HIGH: "High",
  URGENT: "Urgent",
};

export function PriorityBadge({
  priority,
  compact = false,
}: {
  priority: Priority;
  compact?: boolean;
}) {
  return (
    <span
      title={`Priority: ${LABEL[priority]}`}
      className={`inline-flex items-center rounded-full font-display text-[11px] font-semibold leading-[18px] ${TONE_CLASS[TONE[priority]]} ${compact ? "px-1.5 py-0.5" : "px-2 py-0.5"}`}
    >
      {LABEL[priority]}
    </span>
  );
}
