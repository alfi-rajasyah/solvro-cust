// "Primary" marker on a project's primary customer
// (docs/archive/plans/multi-customer-projects.md). Bespoke like the other chips:
// a tinted bg + on-container text pair, 12px.
export function PrimaryChip({ className }: { className?: string }) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-sm bg-primary/10 px-1.5 py-0.5 text-meta text-primary dark:bg-primary/20",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      Primary
    </span>
  );
}
