export function WorkLogs() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant">schedule</span>
      </div>

      <div className="space-y-1">
        <h1 className="font-display text-h2 text-on-surface">Work Logs</h1>
        <p className="max-w-sm text-sm text-on-surface-variant">
          Time tracking and work log history will be available here. Backend wiring is in progress.
        </p>
      </div>

      <span className="rounded-full bg-surface-container px-3 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface-variant">
        Preview only
      </span>
    </div>
  );
}
