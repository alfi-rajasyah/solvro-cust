import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OpportunityFormModal } from "@/components/OpportunityFormModal";
import { PipelineImportDialog } from "@/components/PipelineImportDialog";
import { PipelineKpiBar } from "@/components/pipeline/PipelineKpiBar";
import { SolvroPipelineKanban, type SolvroPipelineKanbanHandle } from "@/components/pipeline/SolvroPipelineKanban";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { hasPermission, useAuth } from "@/lib/auth";
import { useOpportunities } from "@/lib/queries";
import { PipelineList } from "@/pages/views/PipelineList";
import { PipelineQuarter } from "@/pages/views/PipelineQuarter";
import { PipelineSwimlane } from "@/pages/views/PipelineSwimlane";

type ViewMode = "kanban" | "list" | "swimlane" | "quarter";

// View-switcher shell (PRD §2.3's mockup toolbar row). M2 shipped this as a
// static, Kanban-only shell (all other buttons disabled, "Arrives in a
// later milestone" tooltip) — this task (M3 integration) wires all 4.
//
// Persistence: mirrors CustomerDetail.tsx's `?tab=` convention — the house
// pattern for a same-page view switcher (as opposed to ProjectDetail.tsx's
// tab convention, which is actually nested *routes*, not client state; that
// would mean adding /pipeline/kanban, /pipeline/list, etc. to App.tsx, out
// of this task's scoped files). "kanban" is the default and stays out of
// the URL, same as CustomerDetail omitting `?tab=overview`.
const VIEW_MODES: { id: ViewMode; label: string; icon: string }[] = [
  { id: "kanban", label: "Kanban", icon: "view_kanban" },
  { id: "list", label: "List", icon: "view_list" },
  { id: "swimlane", label: "Swimlane", icon: "view_agenda" },
  { id: "quarter", label: "Quarter", icon: "calendar_view_month" },
];

function isViewMode(value: string | null): value is ViewMode {
  return VIEW_MODES.some((m) => m.id === value);
}

export function Pipeline() {
  const { user } = useAuth();
  const canCreate = hasPermission(user, "pipeline:create");

  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<ViewMode>(() => {
    const v = searchParams.get("view");
    return isViewMode(v) ? v : "kanban";
  });

  // Honor ?view= changes from external navigation (e.g. a future deep link
  // or the browser back/forward button) — same effect CustomerDetail.tsx
  // runs for its own ?tab= param.
  useEffect(() => {
    const v = searchParams.get("view");
    if (isViewMode(v) && v !== view) setView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function handleViewChange(next: ViewMode) {
    setView(next);
    // Functional form — mutates the updater's own draft `URLSearchParams`
    // rather than the `searchParams` instance this render closed over
    // (React Router warns that a stale/mutated instance from `useState`
    // shouldn't be written back directly; the callback form always
    // operates on the current one).
    setSearchParams(
      (prev) => {
        if (next === "kanban") prev.delete("view");
        else prev.set("view", next);
        return prev;
      },
      { replace: true },
    );
  }

  // Hoisted KPI bar (PRD §2.4: "shared toolbar and KPI bar stay mounted
  // across views") — SolvroPipelineKanban no longer mounts its own
  // PipelineKpiBar (List/Swimlane/Quarter never did, by design — see their
  // own header comments). This `useOpportunities()` call shares the same
  // `pipelineKeys.list` cache entry the active view's own call reads, so
  // it's a cache hit once either has fetched, not a second network
  // round-trip.
  const { data: deals, isLoading, isError, error } = useOpportunities();

  // Funnel-strip scroll-to-column (PRD §2.3's mockup) only makes sense
  // against the Kanban view's columns — List/Swimlane/Quarter have no
  // per-PipelineStage column to scroll to. `kanbanRef` is populated only
  // while SolvroPipelineKanban is actually mounted (forwardRef), so
  // `kanbanRef.current?.scrollToStage(...)` below would be a silent no-op
  // on every other view regardless — but `onFunnelStageClick` is still
  // gated to `view === "kanban"` (below) rather than relying on that no-op:
  // `PipelineKpiBar`'s own `FunnelStrip` uses whether the prop is present
  // (not whether it does anything) to decide `cursor-pointer` vs
  // `cursor-default` and its "scroll to column" aria-label — leaving it
  // wired on every view would keep advertising a working affordance on
  // views where it's actually inert.
  const kanbanRef = useRef<SolvroPipelineKanbanHandle>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-h2 text-on-surface">Pipeline</h1>
          <p className="text-sm text-on-surface-variant">Opportunity stages, at a glance.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-outline-variant" role="group">
            {VIEW_MODES.map((mode, idx) => {
              const active = mode.id === view;
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleViewChange(mode.id)}
                  className={[
                    "inline-flex items-center gap-1.5 px-3 py-1.5 font-display text-xs font-semibold transition-colors",
                    idx > 0 ? "border-l border-outline-variant" : "",
                    active
                      ? "bg-primary text-on-primary"
                      : "text-on-surface-variant hover:bg-surface-container",
                  ].join(" ")}
                >
                  <span className="material-symbols-outlined text-base">{mode.icon}</span>
                  {mode.label}
                </button>
              );
            })}
          </div>

          {canCreate && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-outline-variant px-3 py-1.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant transition-colors hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-base">upload_file</span>
              Import
            </button>
          )}

          {canCreate && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-display text-label-caps uppercase tracking-wider text-on-primary transition-colors hover:bg-primary-container"
            >
              <span className="material-symbols-outlined text-base">add</span>
              New opportunity
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-sm bg-surface-container-low" />
          ))}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertDescription>Could not load Pipeline metrics: {(error as Error).message}</AlertDescription>
        </Alert>
      ) : (
        <PipelineKpiBar
          deals={deals ?? []}
          onFunnelStageClick={
            view === "kanban" ? (stage) => kanbanRef.current?.scrollToStage(stage) : undefined
          }
        />
      )}

      {view === "kanban" && (
        <SolvroPipelineKanban
          ref={kanbanRef}
          onCreateOpportunity={canCreate ? () => setCreateOpen(true) : undefined}
        />
      )}
      {view === "list" && <PipelineList />}
      {view === "swimlane" && <PipelineSwimlane />}
      {view === "quarter" && <PipelineQuarter />}

      <OpportunityFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <PipelineImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
