// Day strip (spec §6.3 pin 1): 7 day buttons, coverage counts, today
// outlined, weekend days muted. Clicking a day never filters the page — it
// asks the parent to scroll/focus the first card's row for that day
// (DailyReview.tsx's `focusRequest` state, consumed by ProjectCard's
// WeekNotesEditor).
import { dayLabel } from "@/lib/dailyReviewStats";

export interface WeekStripProps {
  days: string[];
  today: string;
  coverage: Record<string, { withNote: number; total: number }>;
  onDayClick: (day: string) => void;
}

export function WeekStrip({ days, today, coverage, onDayClick }: WeekStripProps) {
  return (
    <div className="grid grid-cols-4 gap-2 md:grid-cols-7" role="group" aria-label="Week days">
      {days.map((day) => {
        const cov = coverage[day] ?? { withNote: 0, total: 0 };
        const isToday = day === today;
        // Weekend-muted rule reads the UTC weekday of the day string
        // directly (0=Sun, 6=Sat) — same UTC-only convention as isoWeek.ts.
        const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
        const isWeekend = weekday === 0 || weekday === 6;
        const full = cov.total > 0 && cov.withNote >= cov.total;
        const label = dayLabel(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => onDayClick(day)}
            aria-label={`Go to ${label} — ${cov.withNote} of ${cov.total} customers noted`}
            className={[
              "flex flex-col items-center gap-0.5 rounded-sm border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              isToday
                ? "border-primary bg-primary/5"
                : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container",
            ].join(" ")}
          >
            <span
              className={`text-[11px] font-bold uppercase tracking-wider ${isWeekend && !isToday ? "text-on-surface-variant" : "text-on-surface"}`}
            >
              {label}
            </span>
            <span
              className={`font-mono text-[11px] tabular-nums ${full ? "text-chip-emerald-text" : "text-on-surface-variant"}`}
            >
              {cov.withNote}/{cov.total}
            </span>
          </button>
        );
      })}
    </div>
  );
}
